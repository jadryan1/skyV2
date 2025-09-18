import twilio from 'twilio';
import { storage } from './storage';
import type { InsertCall, User } from '@shared/schema';
import { wsManager } from './wsManager';
import { buildPrompt } from './promptBuilder'; // ✅ new import

// AI and validation services DISABLED - focusing on raw call data
console.log('🚫 AI and validation services DISABLED for raw call data collection');

const PhoneValidationService = {
  validatePhoneNumber: (phone: string) => ({
    isValid: true,
    isTestNumber: false,
    normalizedNumber: phone,
    reason: 'validation_disabled'
  }),
  logValidation: () => {}
};

const aiService = {
  analyzeTranscriptAuthenticity: () => Promise.resolve({ isRealTranscript: true, reason: 'ai_disabled' }),
  analyzeCall: () => Promise.resolve(null)
};

export class TwilioService {
  constructor() {}

  /**
   * Process recording webhook to save recording URL
   */
  async processRecordingWebhook(webhookData: any): Promise<void> {
    try {
      const { CallSid, RecordingUrl, RecordingSid } = webhookData;

      if (!CallSid || !RecordingUrl) {
        console.log("Recording webhook missing CallSid or RecordingUrl");
        return;
      }

      // Update the call record with recording URL
      await storage.updateCallRecording(CallSid, RecordingUrl);
      console.log(`🎵 Recording saved for call ${CallSid}: ${RecordingUrl}`);
    } catch (error) {
      console.error('Error processing recording webhook:', error);
    }
  }

  /**
   * Process transcription webhook to save transcript
   */
  async processTranscriptionWebhook(webhookData: any): Promise<void> {
    try {
      const { CallSid, TranscriptionText, TranscriptionUrl } = webhookData;

      if (!CallSid || !TranscriptionText) {
        console.log("Transcription webhook missing CallSid or TranscriptionText");
        return;
      }

      // Update the call record with transcript
      await storage.updateCallTranscript(CallSid, TranscriptionText);
      console.log(`📝 Transcript saved for call ${CallSid}: ${TranscriptionText.substring(0, 100)}...`);
    } catch (error) {
      console.error('Error processing transcription webhook:', error);
    }
  }

  /**
   * Process incoming Twilio webhook and create call record for the correct user
   */
  async processCallWebhook(webhookData: any): Promise<void> {
    try {
      const {
        CallSid,
        From,
        To,
        CallStatus,
        CallDuration,
        Direction,
        RecordingUrl
      } = webhookData;

      // Find user by their Twilio phone number
      const user = await this.findUserByTwilioNumber(To, From, Direction);

      if (!user) {
        console.log(
          `No user found for call to/from ${
            Direction === 'inbound' ? From : To
          }`
        );
        return;
      }

      // Fetch business info for prompt context
      const businessInfo = await storage.getBusinessInfo(user.id);

      // Fetch user's calls for prompt context
      const userCalls = await storage.getCallsByUserId(user.id);

      // Generate business-specific prompt
      const prompt = buildPrompt(businessInfo, userCalls);

      // Map Twilio status to our status enum
      const status = this.mapTwilioStatus(CallStatus);

      // Create call record for the user
      const callData: InsertCall = {
        userId: user.id,
        phoneNumber: Direction === 'inbound' ? From : To,
        contactName: null,
        duration: CallDuration ? parseInt(CallDuration) : null,
        status,
        notes: this.getCallStatusNote(status, CallStatus, CallDuration),
        summary: null,
        twilioCallSid: CallSid,
        direction: Direction,
        recordingUrl: RecordingUrl || null,
        isFromTwilio: true,
        // ✅ save generated prompt in the DB
        aiPrompt: prompt,
      } as any; // add `as any` if schema doesn’t yet include aiPrompt

      const result = await storage.createCall(callData);
      console.log(`📞 Call logged for user ${user.id}: ${CallSid}`);
      console.log(`📣 Generated prompt: ${prompt}`);

      // Broadcast real-time call update to connected clients
      try {
        const broadcastData = {
          type: 'call_update',
          userId: user.id,
          call: {
            ...result,
            status: result.status || status,
            isLive: result.status === 'in-progress'
          },
          timestamp: new Date().toISOString()
        };

        const clientCount = wsManager.broadcastToUser(user.id, broadcastData);
        console.log(`📡 Broadcasted Twilio call to ${clientCount} connected clients for user ${user.id}`);
      } catch (error) {
        console.error('Error broadcasting Twilio call update:', error);
      }
    } catch (error) {
      console.error('Error processing Twilio webhook:', error);
    }
  }

  /**
   * Process incoming Twilio webhook specifically for user 3 - bypasses phone number matching
   * and captures ALL calls regardless of phone number
   */
  async processUser3CallWebhook(webhookData: any): Promise<void> {
    try {
      const {
        CallSid,
        From,
        To,
        CallStatus,
        CallDuration,
        Direction,
        RecordingUrl
      } = webhookData;

      console.log(`🔍 USER3 WEBHOOK: Processing call data for user 3 - CallSid: ${CallSid}`);
      console.log(`📞 USER3 WEBHOOK: From: ${From}, To: ${To}, Status: ${CallStatus}, Direction: ${Direction}`);

      // Hardcode userId to 3 - bypass phone number matching
      const userId = 3;

      // Get user 3 to verify they exist
      const user = await storage.getUser(userId);
      if (!user) {
        console.log(`❌ USER3 WEBHOOK: User 3 not found in database`);
        return;
      }

      // Fetch business info for user 3 for prompt context
      const businessInfo = await storage.getBusinessInfo(userId);

      // Fetch user 3's calls for prompt context
      const userCalls = await storage.getCallsByUserId(userId);

      // Generate business-specific prompt for user 3
      const prompt = buildPrompt(businessInfo, userCalls);

      // Map Twilio status to our status enum
      const status = this.mapTwilioStatus(CallStatus);

      // Create call record for user 3
      const callData: InsertCall = {
        userId: userId,
        phoneNumber: Direction === 'inbound' ? From : To,
        contactName: null,
        duration: CallDuration ? parseInt(CallDuration) : null,
        status,
        notes: this.getCallStatusNote(status, CallStatus, CallDuration),
        summary: null,
        twilioCallSid: CallSid,
        direction: Direction,
        recordingUrl: RecordingUrl || null,
        isFromTwilio: true,
        // Save generated prompt in the DB
        aiPrompt: prompt,
      } as any;

      const result = await storage.createCall(callData);
      console.log(`✅ USER3 WEBHOOK: Call logged for user 3: ${CallSid}`);
      console.log(`📋 USER3 WEBHOOK: Status: ${CallStatus} -> ${status}, Duration: ${CallDuration}s`);
      console.log(`🤖 USER3 WEBHOOK: Generated prompt: ${prompt}`);
      console.log(`📊 USER3 WEBHOOK: Call data created:`, {
        userId: userId,
        phoneNumber: Direction === 'inbound' ? From : To,
        status: status,
        direction: Direction,
        twilioCallSid: CallSid
      });

      // Broadcast real-time call update to connected clients for user 3
      try {
        const broadcastData = {
          type: 'call_update',
          userId: userId,
          call: {
            ...result,
            status: result.status || status,
            isLive: result.status === 'in-progress'
          },
          timestamp: new Date().toISOString()
        };

        const clientCount = wsManager.broadcastToUser(userId, broadcastData);
        console.log(`📡 USER3 WEBHOOK: Broadcasted call to ${clientCount} connected clients for user 3`);
      } catch (error) {
        console.error('❌ USER3 WEBHOOK: Error broadcasting call update:', error);
      }
    } catch (error) {
      console.error('❌ USER3 WEBHOOK: Error processing Twilio webhook for user 3:', error);
    }
  }

  /**
   * ENHANCED USER3 WEBHOOK: Captures ALL call data including full transcripts and audio recordings
   * Ensures every call for user 3 leaves a complete record with transcript and recording URL
   * IMPORTANT: This is for comprehensive data collection and does not affect active calls
   */
  async processUser3CallWebhookEnhanced(webhookData: any): Promise<void> {
    try {
      const {
        CallSid,
        From,
        To,
        CallStatus,
        CallDuration,
        Direction,
        RecordingUrl,
        RecordingSid,
        TranscriptionText,
        TranscriptionUrl,
        TranscriptionStatus
      } = webhookData;

      console.log(`🎯 USER3 ENHANCED: Processing webhook for user 3 - CallSid: ${CallSid}`);
      console.log(`📞 USER3 ENHANCED: From: ${From}, To: ${To}, Status: ${CallStatus}, Direction: ${Direction}`);
      console.log(`📝 USER3 ENHANCED: Full transcript: ${TranscriptionText ? `${TranscriptionText.length} chars` : 'None'}`);
      console.log(`🎵 USER3 ENHANCED: Recording: ${RecordingUrl ? 'Available' : 'Pending'}`);

      // Hardcode userId to 3 - bypass phone number matching
      const userId = 3;

      // Get user 3 to verify they exist
      const user = await storage.getUser(userId);
      if (!user) {
        console.log(`❌ USER3 ENHANCED: User 3 not found in database`);
        return;
      }

      // Extract phone number based on direction
      const phoneNumber = Direction === 'inbound' ? From : To;

      // Map Twilio status to our status enum
      const status = this.mapTwilioStatus(CallStatus);

      // Check if this call already exists in database
      const existingCall = await storage.getCallByTwilioSid(CallSid);
      
      if (existingCall) {
        // **UPDATE EXISTING CALL WITH NEW DATA**
        console.log(`🔄 USER3 ENHANCED: Updating existing call ${CallSid} with new data`);
        
        const updateData: any = {};
        
        // Update transcript if provided
        if (TranscriptionText && TranscriptionText.length > 0) {
          updateData.transcript = TranscriptionText;
          updateData.summary = `📝 Full transcript captured (${TranscriptionText.length} characters): ${TranscriptionText.substring(0, 200)}...`;
          console.log(`📝 USER3 ENHANCED: Updated transcript for call ${CallSid}`);
        }
        
        // Update recording URL if provided
        if (RecordingUrl) {
          updateData.recordingUrl = RecordingUrl;
          console.log(`🎵 USER3 ENHANCED: Updated recording URL for call ${CallSid}`);
        }
        
        // Update status if changed
        if (CallStatus) {
          updateData.status = status;
          updateData.notes = this.getCallStatusNote(status, CallStatus, CallDuration);
        }
        
        // Update duration if provided
        if (CallDuration) {
          updateData.duration = parseInt(CallDuration);
        }
        
        // Apply updates
        if (Object.keys(updateData).length > 0) {
          await storage.updateCall(existingCall.id, updateData);
          console.log(`✅ USER3 ENHANCED: Updated call record ${CallSid} with:`, Object.keys(updateData));
        }
        
      } else {
        // **CREATE NEW CALL RECORD WITH FULL DATA**
        const callData: InsertCall = {
          userId: userId,
          phoneNumber: phoneNumber,
          contactName: null, // No AI processing
          duration: CallDuration ? parseInt(CallDuration) : null,
          status,
          notes: this.getCallStatusNote(status, CallStatus, CallDuration),
          summary: TranscriptionText ? 
            `📝 Full transcript captured (${TranscriptionText.length} characters): ${TranscriptionText.substring(0, 200)}...` : 
            'Call captured - awaiting transcript',
          transcript: TranscriptionText || null, // Store FULL transcript as-is
          twilioCallSid: CallSid,
          direction: Direction,
          recordingUrl: RecordingUrl || null,
          isFromTwilio: true,
          aiPrompt: null, // No AI processing
        } as any;

        const result = await storage.createCall(callData);
        console.log(`✅ USER3 ENHANCED: Created new call record for user 3: ${CallSid}`);
      }

      // **COMPREHENSIVE LOGGING FOR MONITORING**
      console.log(`📊 USER3 ENHANCED: Complete call data processing:`, {
        userId: userId,
        phoneNumber: phoneNumber,
        callSid: CallSid,
        status: status,
        direction: Direction,
        hasTranscript: !!TranscriptionText,
        transcriptLength: TranscriptionText ? TranscriptionText.length : 0,
        hasRecording: !!RecordingUrl,
        recordingUrl: RecordingUrl,
        transcriptionStatus: TranscriptionStatus,
        isUpdate: !!existingCall,
        timestamp: new Date().toISOString()
      });

      // **BROADCAST REAL-TIME UPDATE**
      try {
        const updatedCall = await storage.getCallByTwilioSid(CallSid);
        if (updatedCall) {
          const broadcastData = {
            type: 'call_update',
            userId: userId,
            call: {
              ...updatedCall,
              status: updatedCall.status || status,
              isLive: updatedCall.status === 'in-progress'
            },
            timestamp: new Date().toISOString()
          };

          const clientCount = wsManager.broadcastToUser(userId, broadcastData);
          console.log(`📡 USER3 ENHANCED: Broadcasted enhanced call update to ${clientCount} connected clients`);
        }
      } catch (error) {
        console.error('❌ USER3 ENHANCED: Error broadcasting call update:', error);
      }

    } catch (error) {
      console.error('❌ USER3 ENHANCED: Error processing enhanced webhook for user 3:', error);
    }
  }

  /**
   * Find user by matching their Twilio phone number with strict isolation
   */
  private async findUserByTwilioNumber(to: string, from: string, direction: string): Promise<User | null> {
    try {
      // Get all business info records with Twilio settings
      const businessInfos = await storage.getAllBusinessInfoWithTwilio();

      for (const info of businessInfos) {
        if (!info.twilioPhoneNumber) continue;

        const userNumber = this.normalizePhoneNumber(info.twilioPhoneNumber);
        const callNumber = this.normalizePhoneNumber(direction === 'inbound' ? to : from);

        // Exact match ensures no cross-contamination between accounts
        if (userNumber === callNumber) {
          const user = await storage.getUser(info.userId);
          if (user) {
            console.log(`Call routed to user ${user.id} (${user.email}) via Twilio number ${info.twilioPhoneNumber}`);
            return user;
          }
        }
      }

      console.log(`No user found for Twilio number: ${direction === 'inbound' ? to : from}`);
      return null;
    } catch (error) {
      console.error('Error finding user by Twilio number:', error);
      return null;
    }
  }

  /**
   * Normalize phone numbers for comparison
   */
  private normalizePhoneNumber(phoneNumber: string): string {
    return phoneNumber.replace(/[^\d]/g, '');
  }

  /**
   * Get descriptive note for call based on status
   */
  private getCallStatusNote(status: string, twilioStatus: string, duration?: string): string {
    const callDuration = duration ? `${Math.floor(parseInt(duration) / 60)}m ${parseInt(duration) % 60}s` : '';

    switch (twilioStatus.toLowerCase()) {
      case 'completed':
        return duration && parseInt(duration) < 10 ?
          'Customer ended call quickly' :
          `Call completed ${callDuration}`;
      case 'busy':
        return 'Customer line was busy';
      case 'no-answer':
        return 'Customer did not answer';
      case 'failed':
        return 'Call failed to connect';
      case 'canceled':
      case 'cancelled':
        return 'Call was canceled';
      case 'ringing':
        return 'Call was ringing';
      case 'queued':
        return 'Call was queued';
      default:
        return `Call status: ${twilioStatus}`;
    }
  }

  /**
   * Map Twilio call status to our enum values - handles ALL call types with proper in-progress support
   */
  private mapTwilioStatus(twilioStatus: string): 'in-progress' | 'completed' | 'missed' | 'failed' {
    switch (twilioStatus.toLowerCase()) {
      // Active ongoing calls
      case 'in-progress':
      case 'ringing':
        return 'in-progress';

      // Successful completed calls
      case 'completed':
        return 'completed';

      // Customer/caller ended calls early or didn't answer
      case 'busy':
      case 'no-answer':
      case 'queued':
        return 'missed';

      // Failed or canceled calls
      case 'failed':
      case 'canceled':
      case 'cancelled': // Alternative spelling
        return 'failed';

      // Default for any other status - log it so we can see what we're missing
      default:
        console.log(`📋 Unmapped call status: ${twilioStatus} - defaulting to 'completed'`);
        return 'completed';
    }
  }

  /**
   * Set up webhooks for a user's Twilio account
   */
  async setupWebhooksForUser(userId: number, accountSid: string, authToken: string, phoneNumber: string): Promise<boolean> {
    try {
      // Create Twilio client with user's credentials
      const userTwilioClient = twilio(accountSid, authToken);

      // The webhook URL that Twilio will call for completed calls
      const webhookUrl = `${process.env.REPLIT_DOMAINS?.split(',')[0] ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}` : 'http://localhost:5000'}/api/twilio/webhook`;

      // Find the phone number resource and update its webhook
      const phoneNumbers = await userTwilioClient.incomingPhoneNumbers.list();
      const targetNumber = phoneNumbers.find(num => num.phoneNumber === phoneNumber);

      if (targetNumber) {
        await userTwilioClient.incomingPhoneNumbers(targetNumber.sid)
          .update({
            statusCallback: webhookUrl,
            statusCallbackMethod: 'POST'
          });

        console.log(`✅ Webhook configured for ${phoneNumber} - calls will sync to Sky IQ`);
        return true;
      } else {
        console.log(`❌ Phone number ${phoneNumber} not found in Twilio account`);
        return false;
      }

    } catch (error) {
      console.error('Error setting up Twilio webhooks:', error);
      return false;
    }
  }

  /**
   * Validate that user's Twilio credentials are correct
   */
  async validateUserTwilioCredentials(accountSid: string, authToken: string): Promise<boolean> {
    try {
      const userClient = twilio(accountSid, authToken);
      await userClient.api.accounts(accountSid).fetch();
      return true;
    } catch (error) {
      console.error('Invalid Twilio credentials:', error);
      return false;
    }
  }

  /**
   * Create isolated Twilio client for specific user
   */
  private createUserTwilioClient(accountSid: string, authToken: string) {
    return twilio(accountSid, authToken);
  }

  /**
   * Get user's phone numbers from their Twilio account
   */
  async getUserTwilioNumbers(accountSid: string, authToken: string): Promise<string[]> {
    try {
      const userClient = this.createUserTwilioClient(accountSid, authToken);
      const phoneNumbers = await userClient.incomingPhoneNumbers.list();
      return phoneNumbers.map(num => num.phoneNumber);
    } catch (error) {
      console.error('Error fetching user Twilio numbers:', error);
      return [];
    }
  }

  /**
   * Ensure no phone number conflicts between users
   */
  async validateUniquePhoneNumber(userId: number, phoneNumber: string): Promise<boolean> {
    try {
      const businessInfos = await storage.getAllBusinessInfoWithTwilio();

      for (const info of businessInfos) {
        // Check if another user already has this phone number
        if (info.userId !== userId && info.twilioPhoneNumber === phoneNumber) {
          console.error(`Phone number ${phoneNumber} already in use by user ${info.userId}`);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error('Error validating phone number uniqueness:', error);
      return false;
    }
  }

  /**
   * Set up complete Twilio integration for a user with validation
   */
  async setupUserTwilioIntegration(userId: number, accountSid: string, authToken: string, phoneNumber: string): Promise<{success: boolean, message: string}> {
    try {
      // Step 1: Validate credentials
      const credentialsValid = await this.validateUserTwilioCredentials(accountSid, authToken);
      if (!credentialsValid) {
        return { success: false, message: 'Invalid Twilio credentials' };
      }

      // Step 2: Validate phone number uniqueness
      const phoneNumberUnique = await this.validateUniquePhoneNumber(userId, phoneNumber);
      if (!phoneNumberUnique) {
        return { success: false, message: 'Phone number already in use by another account' };
      }

      // Step 3: Verify user owns this phone number
      const userNumbers = await this.getUserTwilioNumbers(accountSid, authToken);
      if (!userNumbers.includes(phoneNumber)) {
        return { success: false, message: 'Phone number not found in your Twilio account' };
      }

      // Step 4: Save Twilio settings to user's business profile
      await storage.updateTwilioSettings(userId, { accountSid, authToken, phoneNumber });

      // Step 5: Set up webhooks for call routing
      const webhookSetup = await this.setupWebhooksForUser(userId, accountSid, authToken, phoneNumber);
      if (!webhookSetup) {
        return { success: false, message: 'Failed to configure webhooks' };
      }

      console.log(`✅ Complete Twilio integration setup for user ${userId} with number ${phoneNumber}`);
      return { success: true, message: 'Twilio integration configured successfully' };

    } catch (error) {
      console.error('Error setting up Twilio integration:', error);
      return { success: false, message: 'Failed to set up Twilio integration' };
    }
  }
}

export const twilioService = new TwilioService();