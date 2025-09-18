import { log } from 'console';

/**
 * Phone Number Validation Service
 * Validates phone numbers to detect test/fake numbers and ensure data quality
 */

export interface PhoneValidationResult {
  isValid: boolean;
  isTestNumber: boolean;
  reason?: string;
  normalizedNumber?: string;
}

export class PhoneValidationService {
  // Test number patterns that should be rejected
  private static readonly TEST_PATTERNS = [
    // 555 numbers (traditional test numbers)
    /^\+?1?[-.(\s]*555[-.)\s]*\d{4}$/,
    // Specific test ranges
    /^\+?1?[-.(\s]*555[-.)\s]*0\d{3}$/, // 555-0xxx
    /^\+?1?[-.(\s]*555[-.)\s]*1\d{3}$/, // 555-1xxx
    // Common fake numbers
    /^\+?1?[-.(\s]*123[-.)\s]*456[-.)\s]*7890$/, // 123-456-7890
    /^\+?1?[-.(\s]*555[-.)\s]*123[-.)\s]*4567$/, // 555-123-4567
    // Obvious patterns
    /^\+?1?[-.(\s]*(\d)\1{9}$/, // All same digits (e.g., 1111111111)
    /^\+?1?[-.(\s]*1{10}$/, // All 1s
    /^\+?1?[-.(\s]*0{10}$/, // All 0s
    // Sequential numbers
    /^\+?1?[-.(\s]*123[-.)\s]*456[-.)\s]*7890$/,
    /^\+?1?[-.(\s]*987[-.)\s]*654[-.)\s]*3210$/,
  ];

  // Reserved/special number ranges
  private static readonly RESERVED_PATTERNS = [
    // N11 numbers (411, 511, 611, 711, 811, 911)
    /^\+?1?[-.(\s]*[2-9]11[-.)\s]*$/,
    // Toll-free numbers (should be valid but noted)
    /^\+?1?[-.(\s]*8[0-8][0-8][-.)\s]*\d{7}$/,
    // Premium rate numbers
    /^\+?1?[-.(\s]*900[-.)\s]*\d{7}$/,
  ];

  /**
   * Validate a phone number for legitimacy
   * @param phoneNumber The phone number to validate
   * @returns ValidationResult with details about the phone number
   */
  static validatePhoneNumber(phoneNumber: string): PhoneValidationResult {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      return {
        isValid: false,
        isTestNumber: false,
        reason: 'Phone number is required and must be a string'
      };
    }

    const normalizedNumber = this.normalizePhoneNumber(phoneNumber);
    
    // Check if it's empty after normalization
    if (!normalizedNumber) {
      return {
        isValid: false,
        isTestNumber: false,
        reason: 'Phone number contains no digits',
        normalizedNumber
      };
    }

    // Check for minimum length (US numbers should be 10 digits minimum)
    if (normalizedNumber.length < 10) {
      return {
        isValid: false,
        isTestNumber: false,
        reason: 'Phone number is too short (minimum 10 digits required)',
        normalizedNumber
      };
    }

    // Check for maximum length (international numbers shouldn't exceed 15 digits)
    if (normalizedNumber.length > 15) {
      return {
        isValid: false,
        isTestNumber: false,
        reason: 'Phone number is too long (maximum 15 digits allowed)',
        normalizedNumber
      };
    }

    // Check against test number patterns
    for (const pattern of this.TEST_PATTERNS) {
      if (pattern.test(phoneNumber)) {
        console.warn(`📞 VALIDATION: Detected test number pattern: ${phoneNumber}`);
        return {
          isValid: false,
          isTestNumber: true,
          reason: 'Phone number matches known test number pattern',
          normalizedNumber
        };
      }
    }

    // Specific 555 number validation (more granular)
    if (this.is555TestNumber(phoneNumber)) {
      console.warn(`📞 VALIDATION: Detected 555 test number: ${phoneNumber}`);
      return {
        isValid: false,
        isTestNumber: true,
        reason: 'Phone number is in 555 test range (555-0000 to 555-9999)',
        normalizedNumber
      };
    }

    // Check for obviously fake patterns
    if (this.hasObviousFakePatterns(normalizedNumber)) {
      console.warn(`📞 VALIDATION: Detected fake number pattern: ${phoneNumber}`);
      return {
        isValid: false,
        isTestNumber: true,
        reason: 'Phone number appears to be fake (repetitive or sequential digits)',
        normalizedNumber
      };
    }

    // Check for reserved numbers (valid but special)
    for (const pattern of this.RESERVED_PATTERNS) {
      if (pattern.test(phoneNumber)) {
        console.log(`📞 VALIDATION: Detected special number: ${phoneNumber}`);
        // These are valid but we might want to handle them differently
        break;
      }
    }

    // If we get here, the number passes all validation
    console.log(`✅ VALIDATION: Phone number ${phoneNumber} is valid`);
    return {
      isValid: true,
      isTestNumber: false,
      normalizedNumber
    };
  }

  /**
   * Normalize a phone number by removing all non-digit characters
   * @param phoneNumber Raw phone number
   * @returns Normalized phone number with only digits
   */
  static normalizePhoneNumber(phoneNumber: string): string {
    if (!phoneNumber) return '';
    
    // Remove all non-digit characters
    const digitsOnly = phoneNumber.replace(/[^\d]/g, '');
    
    // Remove leading 1 for US numbers if present (11 digits total)
    if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
      return digitsOnly.substring(1);
    }
    
    return digitsOnly;
  }

  /**
   * Check if number is in 555 test range
   * @param phoneNumber Phone number to check
   * @returns true if it's a 555 test number
   */
  private static is555TestNumber(phoneNumber: string): boolean {
    const normalized = this.normalizePhoneNumber(phoneNumber);
    
    // US numbers: check if area code or exchange is 555
    if (normalized.length === 10) {
      const areaCode = normalized.substring(0, 3);
      const exchange = normalized.substring(3, 6);
      
      // Traditional 555 test numbers
      if (areaCode === '555' || exchange === '555') {
        return true;
      }
    }
    
    // International format: check for +1555 pattern
    if (phoneNumber.includes('1555') || phoneNumber.includes('+1555')) {
      return true;
    }
    
    return false;
  }

  /**
   * Check for obviously fake patterns in normalized numbers
   * @param normalizedNumber Normalized phone number (digits only)
   * @returns true if the number appears fake
   */
  private static hasObviousFakePatterns(normalizedNumber: string): boolean {
    // All same digit
    const allSameDigit = /^(\d)\1+$/.test(normalizedNumber);
    if (allSameDigit) return true;

    // Sequential ascending (1234567890, 0123456789)
    let isSequentialAsc = true;
    for (let i = 1; i < normalizedNumber.length; i++) {
      const current = parseInt(normalizedNumber[i]);
      const previous = parseInt(normalizedNumber[i - 1]);
      if (current !== (previous + 1) % 10) {
        isSequentialAsc = false;
        break;
      }
    }
    if (isSequentialAsc) return true;

    // Sequential descending (9876543210, 0987654321)
    let isSequentialDesc = true;
    for (let i = 1; i < normalizedNumber.length; i++) {
      const current = parseInt(normalizedNumber[i]);
      const previous = parseInt(normalizedNumber[i - 1]);
      if (current !== (previous - 1 + 10) % 10) {
        isSequentialDesc = false;
        break;
      }
    }
    if (isSequentialDesc) return true;

    // Too many repeated patterns (1212121212, 1234123412)
    const hasRepeatingPattern = this.hasExcessiveRepeatingPattern(normalizedNumber);
    if (hasRepeatingPattern) return true;

    return false;
  }

  /**
   * Check for excessive repeating patterns
   * @param normalizedNumber Normalized phone number
   * @returns true if there are excessive repeating patterns
   */
  private static hasExcessiveRepeatingPattern(normalizedNumber: string): boolean {
    // Check for 2-digit patterns (1212121212)
    for (let len = 2; len <= 4; len++) {
      for (let start = 0; start <= normalizedNumber.length - len * 3; start++) {
        const pattern = normalizedNumber.substring(start, start + len);
        let repeatCount = 1;
        
        for (let i = start + len; i <= normalizedNumber.length - len; i += len) {
          if (normalizedNumber.substring(i, i + len) === pattern) {
            repeatCount++;
          } else {
            break;
          }
        }
        
        // If a pattern repeats 3+ times, it's likely fake
        if (repeatCount >= 3) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Log validation decision for debugging
   * @param phoneNumber Original phone number
   * @param result Validation result
   * @param context Additional context (e.g., 'webhook', 'api')
   */
  static logValidation(phoneNumber: string, result: PhoneValidationResult, context: string = 'validation'): void {
    const logLevel = result.isValid ? 'log' : result.isTestNumber ? 'warn' : 'error';
    const emoji = result.isValid ? '✅' : result.isTestNumber ? '⚠️' : '❌';
    
    console[logLevel](`${emoji} PHONE VALIDATION [${context.toUpperCase()}]: ${phoneNumber} -> ${result.isValid ? 'VALID' : 'INVALID'}${result.reason ? ` (${result.reason})` : ''}`);
  }

  /**
   * Quick validation check - returns boolean
   * @param phoneNumber Phone number to validate
   * @returns true if valid and not a test number
   */
  static isValidLegitimateNumber(phoneNumber: string): boolean {
    const result = this.validatePhoneNumber(phoneNumber);
    return result.isValid && !result.isTestNumber;
  }

  /**
   * Get validation statistics for debugging
   * @param phoneNumbers Array of phone numbers to analyze
   * @returns Statistics about validation results
   */
  static getValidationStats(phoneNumbers: string[]): {
    total: number;
    valid: number;
    testNumbers: number;
    invalid: number;
    validationRate: number;
  } {
    const results = phoneNumbers.map(num => this.validatePhoneNumber(num));
    
    return {
      total: results.length,
      valid: results.filter(r => r.isValid && !r.isTestNumber).length,
      testNumbers: results.filter(r => r.isTestNumber).length,
      invalid: results.filter(r => !r.isValid && !r.isTestNumber).length,
      validationRate: results.length > 0 ? results.filter(r => r.isValid && !r.isTestNumber).length / results.length : 0
    };
  }
}

export default PhoneValidationService;