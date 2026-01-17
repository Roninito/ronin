import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";

interface QueuedMessage {
  from: string;
  content: string;
  timestamp: number;
}

/**
 * Voice Messaging Agent
 * 
 * Handles voice-activated messaging via Realm:
 * - Listens for voice commands like "send Tyro a message: I'll be there around 3 on Thursday"
 * - Receives messages from other Ronin instances via Realm
 * - Queues messages until user is available
 * - Relays messages via TTS when user is active
 * 
 * Note: STT/TTS functionality requires browser APIs or external services.
 * This agent provides the structure and can be extended with actual STT/TTS implementations.
 */
export default class VoiceMessagingAgent extends BaseAgent {
  private messageQueue: QueuedMessage[] = [];
  private isUserAvailable: boolean = false;
  private lastActivityTime: number = Date.now();
  private availabilityCheckInterval: NodeJS.Timeout | null = null;

  constructor(api: AgentAPI) {
    super(api);

    // Listen for incoming Realm messages
    this.api.events.on("realm:message", (data: { from: string; content: string }) => {
      this.handleIncomingMessage(data.from, data.content);
    });

    // Start availability monitoring
    this.startAvailabilityMonitoring();
  }

  async execute(): Promise<void> {
    console.log("[voice-messaging] Agent started");
    console.log("[voice-messaging] Listening for voice commands and incoming messages...");
    
    // Check if Realm is initialized
    if (!this.api.realm) {
      console.warn("[voice-messaging] Realm plugin not available. Initialize with: ronin realm connect");
      return;
    }

    // Process queued messages if user is available
    await this.processMessageQueue();
  }

  /**
   * Handle incoming message from Realm
   */
  private handleIncomingMessage(from: string, content: string): void {
    console.log(`[voice-messaging] Message received from ${from}: ${content}`);
    
    const message: QueuedMessage = {
      from,
      content,
      timestamp: Date.now(),
    };

    this.messageQueue.push(message);
    console.log(`[voice-messaging] Message queued. Queue size: ${this.messageQueue.length}`);

    // Try to deliver immediately if user is available
    this.processMessageQueue();
  }

  /**
   * Process queued messages if user is available
   */
  private async processMessageQueue(): Promise<void> {
    if (!this.isUserAvailable || this.messageQueue.length === 0) {
      return;
    }

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;
      await this.relayMessage(message);
    }
  }

  /**
   * Relay a message to the user (via TTS or console)
   */
  private async relayMessage(message: QueuedMessage): Promise<void> {
    const announcement = `Message from ${message.from}: ${message.content}`;
    console.log(`[voice-messaging] 🔊 ${announcement}`);

    // TODO: Implement TTS here
    // Example with browser TTS API (if running in browser context):
    // if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    //   const utterance = new SpeechSynthesisUtterance(announcement);
    //   window.speechSynthesis.speak(utterance);
    // }

    // Store in memory for reference
    await this.api.memory.store(`message:${message.timestamp}`, {
      from: message.from,
      content: message.content,
      timestamp: message.timestamp,
    });
  }

  /**
   * Start monitoring user availability
   */
  private startAvailabilityMonitoring(): void {
    // Check availability every 5 seconds
    this.availabilityCheckInterval = setInterval(() => {
      this.checkUserAvailability();
    }, 5000);

    // Initial check
    this.checkUserAvailability();
  }

  /**
   * Check if user is available (simple heuristic based on activity)
   */
  private checkUserAvailability(): void {
    const timeSinceLastActivity = Date.now() - this.lastActivityTime;
    const AVAILABILITY_TIMEOUT = 60000; // 1 minute

    // User is available if they've been active recently
    // In a real implementation, this could check:
    // - Keyboard/mouse activity (via OS hooks)
    // - Voice input detection
    // - CLI interaction
    // - System idle time
    
    const wasAvailable = this.isUserAvailable;
    this.isUserAvailable = timeSinceLastActivity < AVAILABILITY_TIMEOUT;

    if (!wasAvailable && this.isUserAvailable) {
      console.log("[voice-messaging] User is now available");
      this.processMessageQueue();
    }
  }

  /**
   * Mark user as active (call this when user interacts)
   */
  private markUserActive(): void {
    this.lastActivityTime = Date.now();
    if (!this.isUserAvailable) {
      this.isUserAvailable = true;
      this.processMessageQueue();
    }
  }

  /**
   * Parse voice command and send message
   * 
   * Example: "Hey Ronin, send Tyro a message: I'll be there around 3 on Thursday"
   */
  async handleVoiceCommand(transcript: string): Promise<void> {
    // Mark user as active
    this.markUserActive();

    // Parse command
    const lowerTranscript = transcript.toLowerCase();
    
    // Pattern: "send <callsign> a message: <content>"
    const sendPattern = /send\s+(\w+)\s+(?:a\s+)?message[:\s]+(.+)/i;
    const match = transcript.match(sendPattern);

    if (!match) {
      console.log("[voice-messaging] Command not recognized:", transcript);
      return;
    }

    const [, targetCallSign, messageContent] = match;

    if (!this.api.realm) {
      console.error("[voice-messaging] Realm not initialized");
      return;
    }

    try {
      console.log(`[voice-messaging] Sending message to ${targetCallSign}: ${messageContent}`);
      await this.api.realm.sendMessage(targetCallSign, messageContent.trim());
      console.log(`[voice-messaging] ✅ Message sent to ${targetCallSign}`);

      // Confirmation (could use TTS)
      const confirmation = `Message sent to ${targetCallSign}`;
      console.log(`[voice-messaging] 🔊 ${confirmation}`);
      
      // TODO: TTS confirmation
      // if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      //   const utterance = new SpeechSynthesisUtterance(confirmation);
      //   window.speechSynthesis.speak(utterance);
      // }
    } catch (error) {
      console.error(`[voice-messaging] Failed to send message:`, error);
      const errorMsg = `Failed to send message to ${targetCallSign}`;
      console.log(`[voice-messaging] 🔊 ${errorMsg}`);
    }
  }

  /**
   * Example: Start voice recognition (browser-based)
   * 
   * This is a template that can be extended with actual STT implementation.
   * For browser environments, you can use the Web Speech API.
   */
  startVoiceRecognition(): void {
    // Browser-based STT example:
    // if (typeof window !== 'undefined' && 'webkitSpeechRecognition' in window) {
    //   const recognition = new (window as any).webkitSpeechRecognition();
    //   recognition.continuous = true;
    //   recognition.interimResults = false;
    //   
    //   recognition.onresult = (event: any) => {
    //     const transcript = event.results[event.results.length - 1][0].transcript;
    //     if (transcript.toLowerCase().includes('hey ronin') || transcript.toLowerCase().includes('ronin')) {
    //       this.handleVoiceCommand(transcript);
    //     }
    //   };
    //   
    //   recognition.onerror = (event: any) => {
    //     console.error('[voice-messaging] Speech recognition error:', event.error);
    //   };
    //   
    //   recognition.start();
    // }

    console.log("[voice-messaging] Voice recognition not started (requires browser environment or external STT service)");
    console.log("[voice-messaging] To test, call handleVoiceCommand() directly with a transcript");
  }

  /**
   * Cleanup on agent shutdown
   */
  async cleanup(): Promise<void> {
    if (this.availabilityCheckInterval) {
      clearInterval(this.availabilityCheckInterval);
    }
    this.api.events.off("realm:message", this.handleIncomingMessage);
  }
}
