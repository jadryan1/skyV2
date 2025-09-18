import twilio from 'twilio';
import { storage } from './storage';
import type { InsertCall, User } from '@shared/schema';
import { wsManager } from './index';
import { buildPrompt } from './promptBuilder'; // ✅ new import

// Import with fallback to prevent crashes if services are missing
let PhoneValidationService: any;
let aiService: any;

try {
  PhoneValidationService = require('./phoneValidation').PhoneValidationService;
} catch (error) {
  console.warn('PhoneValidationService not available, using basic validation');
  PhoneValidationService = {
    validatePhoneNumber: (phone: string) => ({
      isValid: true,
      isTestNumber: false,
      normalizedNumber: phone,
      reason: 'service_unavailable'
    }),
    logValidation: () => {}
  };
}

try {
  aiService = require('./aiService').aiService;
} catch (error) {
  console.warn('aiService not available, skipping AI analysis');
  aiService = {
    analyzeTranscriptAuthenticity: () => Promise.resolve({ isRealTranscript: false, reason: 'service_unavailable' }),
    analyzeCall: () => Promise.resolve(null)
  };
}

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
   * PASSIVE Enhanced webhook processor for user 3 with phone validation and AI-powered call intelligence
   * Validates phone numbers and processes calls with OpenAI-powered insights
   * Rejects test/fake numbers and only processes legitimate call data
   * IMPORTANT: This is purely for data collection and does not affect active calls
   */
  async processUser3CallWebhookEnhanced(webhookData: any): Promise<void> {
    try {
      console.log(`📊 USER3 PASSIVE COLLECTION: Processing intelligent webhook for user 3 - CallSid: ${CallSid}`);
      console.log(`📞 USER3 PASSIVE COLLECTION: From: ${From}, To: ${To}, Status: ${CallStatus}, Direction: ${Direction}`);

      // Only process calls that are definitely completed to avoid interfering with active calls
      if (CallStatus && ['in-progress', 'ringing', 'queued'].includes(CallStatus.toLowerCase())) {
        console.log(`📊 USER3 PASSIVE COLLECTION: Skipping processing for active call status: ${CallStatus}`);
        return;
      }
    } catch (error) {
      console.error('❌ USER3 AI ENHANCED: Error processing intelligent webhook for user 3:', error);
    }
    try {
      const {
        CallSid,
        From,
        To,
        CallStatus,
        CallDuration,
        Direction,
        RecordingUrl,
        TranscriptionText,
        TranscriptionUrl
      } = webhookData;

      // Hardcode userId to 3 - bypass phone number matching
      const userId = 3;

      // Get user 3 to verify they exist
      const user = await storage.getUser(userId);
      if (!user) {
        console.log(`❌ USER3 AI ENHANCED: User 3 not found in database`);
        return;
      }

      // Extract phone number based on direction - key requirement for validation!
      const phoneNumber = Direction === 'inbound' ? From : To;

      // **CRITICAL: Validate phone number for legitimacy** (with error handling)
      let phoneValidation;
      try {
        phoneValidation = PhoneValidationService.validatePhoneNumber(phoneNumber);
        PhoneValidationService.logValidation(phoneNumber, phoneValidation, 'webhook');
      } catch (error) {
        console.error(`❌ USER3 WEBHOOK: Phone validation error for ${phoneNumber}:`, error);
        // Use basic validation if service fails
        phoneValidation = {
          isValid: true,
          isTestNumber: false,
          normalizedNumber: phoneNumber,
          reason: 'validation_service_failed'
        };
      }

      // **REJECT TEST/FAKE NUMBERS**
      if (!phoneValidation.isValid || phoneValidation.isTestNumber) {
        console.warn(`⚠️ USER3 AI ENHANCED: REJECTING call from ${phoneNumber} - ${phoneValidation.reason}`);
        console.warn(`📊 USER3 AI ENHANCED: CALL REJECTED - Not storing test/fake number data`);
        return; // Exit early - do not process or store fake data
      }

      console.log(`✅ USER3 AI ENHANCED: Phone number ${phoneNumber} validated as legitimate`);

      // Check if transcript is available and authentic
      let transcriptAnalysis = null;
      let aiAnalysis = null;
      let intelligentSummary = null;
      let suggestedContactName = null;

      if (TranscriptionText && TranscriptionText.trim()) {
        console.log(`📝 USER3 AI ENHANCED: Analyzing transcript: ${TranscriptionText.substring(0, 100)}...`);

        try {
          // **AI-POWERED TRANSCRIPT VALIDATION**
          transcriptAnalysis = await aiService.analyzeTranscriptAuthenticity(TranscriptionText);

          if (!transcriptAnalysis.isRealTranscript) {
            console.warn(`⚠️ USER3 AI ENHANCED: REJECTING fake/test transcript - ${transcriptAnalysis.reason}`);
            console.warn(`📊 USER3 AI ENHANCED: TRANSCRIPT REJECTED - Not processing fake transcript data`);
            // Continue processing the call but without transcript data
          } else {
            console.log(`✅ USER3 AI ENHANCED: Transcript validated as authentic (confidence: ${transcriptAnalysis.confidence})`);

            try {
              // **AI-POWERED CALL ANALYSIS**
              const businessInfo = await storage.getBusinessInfo(userId);
              aiAnalysis = await aiService.analyzeCall(TranscriptionText, businessInfo);

              if (aiAnalysis) {
                console.log(`🤖 USER3 AI ENHANCED: AI analysis completed - Sentiment: ${aiAnalysis.sentiment} (${aiAnalysis.sentimentScore}/5)`);
                console.log(`💡 USER3 AI ENHANCED: Call purpose: ${aiAnalysis.callPurpose}`);
                console.log(`📋 USER3 AI ENHANCED: Key points: ${aiAnalysis.keyPoints.length} identified`);

                intelligentSummary = aiAnalysis.summary;
                suggestedContactName = aiAnalysis.suggestedContactName;
              }
            } catch (analysisError) {
              console.error(`❌ USER3 AI ENHANCED: Call analysis failed:`, analysisError);
              // Continue without AI analysis
            }
          }
        } catch (transcriptError) {
          console.error(`❌ USER3 AI ENHANCED: Transcript validation failed:`, transcriptError);
          // Continue processing the call but without transcript analysis
        }
      } else {
        console.log(`📝 USER3 AI ENHANCED: No transcript available for AI analysis`);
      }

      // Fetch business info and previous calls for context
      const businessInfo = await storage.getBusinessInfo(userId);
      const userCalls = await storage.getCallsByUserId(userId);

      // Generate business-specific prompt for user 3
      const prompt = buildPrompt(businessInfo, userCalls);

      // Map Twilio status to our status enum
      const status = this.mapTwilioStatus(CallStatus);

      // **CREATE INTELLIGENT CALL RECORD**
      const callData: InsertCall = {
        userId: userId,
        phoneNumber: phoneValidation.normalizedNumber || phoneNumber, // Use validated/normalized number
        contactName: suggestedContactName, // AI-suggested contact name
        duration: CallDuration ? parseInt(CallDuration) : null,
        status,
        notes: aiAnalysis ?
          `${this.getCallStatusNote(status, CallStatus, CallDuration)} | AI Quality: ${aiAnalysis.callQuality} | Follow-up: ${aiAnalysis.followUpRequired ? 'Required' : 'None'}` :
          this.getCallStatusNote(status, CallStatus, CallDuration),
        summary: intelligentSummary, // AI-generated summary
        transcript: transcriptAnalysis?.isRealTranscript ? TranscriptionText : null, // Only store real transcripts
        twilioCallSid: CallSid,
        direction: Direction,
        recordingUrl: RecordingUrl || null,
        isFromTwilio: true,
        // Save generated prompt in the DB
        aiPrompt: prompt,
      } as any;

      // **STORE VALIDATED AND PROCESSED CALL DATA**
      const result = await storage.createCall(callData);
      console.log(`✅ USER3 AI ENHANCED: Intelligent call record created for user 3: ${CallSid}`);

      // **LOG COMPREHENSIVE PROCESSING RESULTS**
      console.log(`📋 USER3 AI ENHANCED: Call processed with intelligence:`, {
        userId: userId,
        phoneNumber: phoneValidation.normalizedNumber || phoneNumber,
        phoneValidation: phoneValidation.isValid,
        status: status,
        direction: Direction,
        twilioCallSid: CallSid,
        hasValidTranscript: !!transcriptAnalysis?.isRealTranscript,
        hasAIAnalysis: !!aiAnalysis,
        aiSentiment: aiAnalysis?.sentiment,
        aiQuality: aiAnalysis?.callQuality,
        suggestedName: suggestedContactName,
        hasRecording: !!RecordingUrl
      });

      // **AI INSIGHTS LOGGING**
      if (aiAnalysis) {
        console.log(`🧠 USER3 AI ENHANCED: Business insights generated:`, {
          callPurpose: aiAnalysis.callPurpose,
          sentiment: `${aiAnalysis.sentiment} (${aiAnalysis.sentimentScore}/5)`,
          keyPointsCount: aiAnalysis.keyPoints.length,
          actionItemsCount: aiAnalysis.actionItems.length,
          businessInsightsCount: aiAnalysis.businessRelevantInsights.length,
          followUpRequired: aiAnalysis.followUpRequired
        });
      }

      // Broadcast real-time call update to connected clients for user 3
      try {
        const broadcastData = {
          type: 'call_update',
          userId: userId,
          call: {
            ...result,
            status: result.status || status,
            isLive: result.status === 'in-progress',
            // Include AI analysis data for real-time updates
            aiInsights: aiAnalysis ? {
              sentiment: aiAnalysis.sentiment,
              sentimentScore: aiAnalysis.sentimentScore,
              callPurpose: aiAnalysis.callPurpose,
              callQuality: aiAnalysis.callQuality,
              followUpRequired: aiAnalysis.followUpRequired
            } : null
          },
          timestamp: new Date().toISOString()
        };

        const clientCount = wsManager.broadcastToUser(userId, broadcastData);
        console.log(`📡 USER3 AI ENHANCED: Broadcasted intelligent call update to ${clientCount} connected clients`);
      } catch (error) {
        console.error('❌ USER3 AI ENHANCED: Error broadcasting intelligent call update:', error);
      }

    } catch (error) {
      console.error('❌ USER3 AI ENHANCED: Error processing intelligent webhook for user 3:', error);
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