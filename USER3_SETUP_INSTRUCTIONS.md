
# USER3 WEBHOOK SETUP INSTRUCTIONS

## 🔐 HMAC Authentication Setup

To enable secure webhook processing for user 3, you need to set up the Twilio auth token:

### 1. Get Your Twilio Auth Token
1. Go to [Twilio Console](https://console.twilio.com/)
2. Navigate to Account Settings
3. Copy your **Auth Token** (not Account SID)

### 2. Set Environment Variable in Replit
1. Go to Secrets tab in Replit
2. Add a new secret:
   - **Key**: `USER3_TWILIO_AUTH_TOKEN`
   - **Value**: Your actual Twilio auth token

### 3. Configure ElevenLabs Webhook
In your ElevenLabs agent settings, set:
- **Post-Call Webhook URL**: `https://skyiq.app/api/twilio/webhook/user3`
- **Auth Method**: HMAC
- **Send audio data**: ✅ Enabled

## 🎯 What This Enables

✅ **Full Transcript Capture**: Every call will have complete transcripts stored
✅ **Audio Recording URLs**: Links to full call recordings
✅ **HMAC Security**: Only authenticated requests from Twilio/ElevenLabs
✅ **Real-time Updates**: Live dashboard updates as calls come in
✅ **Duplicate Prevention**: Idempotency protection against duplicate webhooks

## 📊 Monitoring

Check the server logs to verify:
- `🎯 USER3 ENHANCED: Processing webhook` - Webhook received
- `📝 USER3 ENHANCED: Full transcript` - Transcript captured
- `🎵 USER3 ENHANCED: Recording` - Audio recording available
- `✅ USER3 ENHANCED: Created/Updated call record` - Data saved

## 🚨 Security Note

The webhook will reject requests with invalid HMAC signatures, ensuring only legitimate Twilio/ElevenLabs requests are processed.
