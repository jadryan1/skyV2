// Update your server/index.ts webhook handler to save to database

// Replace your existing simple webhook handler with this enhanced version:
app.post('/webhooks/twilio/call-status', 
  express.urlencoded({ extended: false }), 
  async (req, res) => {
    try {
      console.log('Twilio webhook received');
      console.log('Body:', req.body);
      
      const {
        CallSid,
        CallStatus,
        From,
        To,
        Direction,
        Duration,
        CallDuration,
        StartTime,
        EndTime,
        CalledCity,
        CallerCity
      } = req.body;

      console.log('📞 Call Event:', {
        CallSid,
        CallStatus,
        From,
        To,
        Direction,
        Duration: Duration || CallDuration
      });

      // Map Twilio call statuses to your database enum
      const mapTwilioStatusToDbStatus = (twilioStatus: string) => {
        switch (twilioStatus?.toLowerCase()) {
          case 'ringing':
          case 'answered': 
          case 'in-progress':
            return 'in-progress';
          case 'completed':
            return 'completed';
          case 'busy':
          case 'no-answer':
            return 'missed';
          case 'failed':
          case 'canceled':
          default:
            return 'failed';
        }
      };

      const dbStatus = mapTwilioStatusToDbStatus(CallStatus);
      const callDuration = Duration ? parseInt(Duration) : (CallDuration ? parseInt(CallDuration) : null);

      // Find the user associated with this phone number
      // You'll need to look up by business phone number
      const userId = await findUserByPhoneNumber(To, From);
      
      if (userId) {
        // Check if call already exists (for status updates)
        const existingCall = await db.select()
          .from(calls)
          .where(eq(calls.twilioCallSid, CallSid))
          .limit(1);

        let callRecord;
        
        if (existingCall.length > 0) {
          // Update existing call
          const [updatedCall] = await db.update(calls)
            .set({
              status: dbStatus,
              duration: callDuration,
              endTime: EndTime ? new Date(EndTime) : null,
              updatedAt: new Date()
            })
            .where(eq(calls.id, existingCall[0].id))
            .returning();
          
          console.log(`✅ Updated existing call ${updatedCall.id} for user ${userId}`);
          callRecord = updatedCall;
        } else {
          // Create new call record
          const [newCall] = await db.insert(calls).values({
            userId: userId,
            twilioCallSid: CallSid,
            phoneNumber: Direction === 'inbound' ? From : To,
            contactName: null, // Will be filled in later if available
            duration: callDuration,
            status: dbStatus,
            direction: Direction === 'inbound' ? 'inbound' : 'outbound',
            startTime: StartTime ? new Date(StartTime) : new Date(),
            endTime: EndTime ? new Date(EndTime) : null,
            createdAt: new Date(),
            city: Direction === 'inbound' ? CallerCity : CalledCity,
            isFromTwilio: true
          }).returning();
          
          console.log(`✅ Created new call ${newCall.id} for user ${userId}`);
          callRecord = newCall;
        }

        // Broadcast real-time update via WebSocket
        try {
          const broadcastData = {
            type: 'call_update',
            userId: userId,
            call: {
              ...callRecord,
              isLive: dbStatus === 'in-progress'
            },
            timestamp: new Date().toISOString()
          };
          
          const clientCount = wsManager.broadcastToUser(userId, broadcastData);
          console.log(`📡 Broadcasted call update to ${clientCount} clients for user ${userId}`);
        } catch (broadcastError) {
          console.error('Error broadcasting call update:', broadcastError);
        }
        
      } else {
        console.log(`❌ No user found for phone numbers: ${From} → ${To}`);
        // Still log the call attempt for debugging
        console.log('📋 Unmatched call logged for analysis');
      }

      // Always respond success to Twilio
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      
    } catch (error) {
      console.error('❌ Error processing Twilio webhook:', error);
      res.type('text/xml');
      res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  }
);

// Helper function to find user by phone number
async function findUserByPhoneNumber(toNumber: string, fromNumber: string): Promise<number | null> {
  try {
    // Import your business schema to look up by phone number
    const { businesses } = await import("@shared/schema");
    
    // Look for a business with matching phone number
    const business = await db.select()
      .from(businesses)
      .where(eq(businesses.twilioPhoneNumber, toNumber))
      .limit(1);
    
    if (business.length > 0) {
      console.log(`🔍 Found user ${business[0].userId} for business phone ${toNumber}`);
      return business[0].userId;
    }
    
    // If no business phone match, could also check user personal phones
    // or implement additional lookup logic here
    
    console.log(`🔍 No user found for phone numbers: ${fromNumber} → ${toNumber}`);
    return null;
    
  } catch (error) {
    console.error('Error finding user by phone number:', error);
    return null;
  }
}

// Also update your GET calls endpoint to use real database data:
// Remove the temporary placeholder and use this instead:
app.get("/api/calls/user/:userId", async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }
    
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    
    // Get total count
    const totalCountResult = await db.select({ count: sql<number>`count(*)` })
      .from(calls)
      .where(eq(calls.userId, userId));
    const totalCount = totalCountResult[0]?.count || 0;
    
    // Get calls for this user (this should already exist in your code)
    const result = await db.select()
      .from(calls)
      .where(eq(calls.userId, userId))
      .orderBy(desc(calls.createdAt))
      .limit(limit)
      .offset(offset);
    
    console.log(`Retrieved ${result.length} calls for user ${userId} (limit: ${limit}, offset: ${offset}, total: ${totalCount})`);
    
    res.status(200).json({ 
      message: "Calls retrieved successfully", 
      data: result,
      count: result.length,
      totalCount,
      limit,
      offset,
      hasMore: offset + result.length < totalCount
    });
  } catch (error) {
    console.error("Error fetching calls:", error);
    res.status(500).json({ message: "Failed to fetch calls" });
  }
});
