import crypto from 'crypto';

// Get encryption key from environment variables
const ENCRYPTION_KEY = process.env.BANK_ENCRYPTION_KEY;
const IV_LENGTH = 16; // For AES, this is always 16

// Validate encryption key
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.error('❌ BANK_ENCRYPTION_KEY must be exactly 64 characters long (32 bytes in hex)');
  console.error('📝 Generate a secure key: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

/**
 * Encrypt text using AES-256-CBC
 * @param {string} text - Text to encrypt
 * @returns {string} - Encrypted text in format: iv:encryptedData
 */
export function encrypt(text) {
  try {
    if (!text) return null;
    
    // Generate a random IV
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Create cipher
    const cipher = crypto.createCipheriv(
      'aes-256-cbc', 
      Buffer.from(ENCRYPTION_KEY, 'hex'), 
      iv
    );
    
    // Encrypt the text
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return IV and encrypted data
    return iv.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('❌ Encryption failed:', error.message);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt text using AES-256-CBC
 * @param {string} encryptedText - Encrypted text in format: iv:encryptedData
 * @returns {string} - Decrypted text
 */
export function decrypt(encryptedText) {
  try {
    if (!encryptedText) return null;
    
    // Split IV and encrypted data
    const [ivHex, encryptedData] = encryptedText.split(':');
    
    if (!ivHex || !encryptedData) {
      throw new Error('Invalid encrypted text format');
    }
    
    // Convert IV back to buffer
    const iv = Buffer.from(ivHex, 'hex');
    
    // Create decipher
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc', 
      Buffer.from(ENCRYPTION_KEY, 'hex'), 
      iv
    );
    
    // Decrypt the data
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('❌ Decryption failed:', error.message);
    throw new Error('Decryption failed');
  }
}

/**
 * Generate a secure encryption key
 * @returns {string} - 32-character hex string
 */
export function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Validate if a string is a valid encryption key
 * @param {string} key - Key to validate
 * @returns {boolean} - True if valid
 */
export function isValidEncryptionKey(key) {
  return key && key.length === 64 && /^[0-9a-fA-F]+$/.test(key);
}

/**
 * Mask sensitive data for display
 * @param {string} text - Text to mask
 * @param {string} type - Type of data ('card', 'cvv', 'expiry')
 * @returns {string} - Masked text
 */
export function maskSensitiveData(text, type = 'card') {
  if (!text) return '';
  
  switch (type) {
    case 'card':
      // Show only last 4 digits
      return text.length > 4 ? '**** **** **** ' + text.slice(-4) : '****';
    case 'cvv':
      // Show only asterisks
      return '***';
    case 'expiry':
      // Show as MM/YY
      return text.length >= 4 ? text.slice(0, 2) + '/' + text.slice(-2) : '**/**';
    default:
      return text;
  }
}

/**
 * Validate card number using Luhn algorithm
 * @param {string} cardNumber - Card number to validate
 * @returns {boolean} - True if valid
 */
export function validateCardNumber(cardNumber) {
  if (!cardNumber) return false;
  
  // Remove spaces and dashes
  const cleanNumber = cardNumber.replace(/\s+/g, '').replace(/-/g, '');
  
  // Check if it's all digits and has reasonable length
  if (!/^\d{13,19}$/.test(cleanNumber)) return false;
  
  // Common test card numbers that should always be allowed in development
  const testCardNumbers = [
    '4111111111111111', // Visa test card
    '4242424242424242', // Visa test card
    '4000056655665556', // Visa test card
    '5555555555554444', // Mastercard test card
    '2223003122003222', // Mastercard test card
    '5200828282828210', // Mastercard test card
    '5105105105105100', // Mastercard test card
    '378282246310005',  // American Express test card
    '371449635398431',  // American Express test card
    '6011111111111117', // Discover test card
    '6011000990139424', // Discover test card
    '3056930009020004', // Diners Club test card
    '3566002020360505', // JCB test card
    '6200000000000005'  // UnionPay test card
  ];
  
  // Allow test card numbers in development
  if (process.env.NODE_ENV === 'development' && testCardNumbers.includes(cleanNumber)) {
    return true;
  }
  
  // Luhn algorithm for real card validation
  let sum = 0;
  let isEven = false;
  
  for (let i = cleanNumber.length - 1; i >= 0; i--) {
    let digit = parseInt(cleanNumber.charAt(i));
    
    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    
    sum += digit;
    isEven = !isEven;
  }
  
  return sum % 10 === 0;
}

/**
 * Validate expiry date
 * @param {string} month - Month (MM)
 * @param {string} year - Year (YYYY or YY)
 * @returns {boolean} - True if valid
 */
export function validateExpiryDate(month, year) {
  if (!month || !year) return false;
  
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;
  
  // Normalize year to 4 digits
  let fullYear = parseInt(year);
  if (fullYear < 100) {
    fullYear += 2000;
  }
  
  const expMonth = parseInt(month);
  const expYear = fullYear;
  
  // Check if expiry is in the future
  if (expYear < currentYear) return false;
  if (expYear === currentYear && expMonth < currentMonth) return false;
  
  // Check if month is valid
  if (expMonth < 1 || expMonth > 12) return false;
  
  return true;
}

/**
 * Validate CVV
 * @param {string} cvv - CVV to validate
 * @returns {boolean} - True if valid
 */
export function validateCVV(cvv) {
  if (!cvv) return false;
  
  // CVV should be 3-4 digits
  return /^\d{3,4}$/.test(cvv);
}

/**
 * Get list of valid test card numbers for development
 * @returns {string[]} - Array of test card numbers
 */
export function getTestCardNumbers() {
  return [
    '4111111111111111', // Visa test card
    '4242424242424242', // Visa test card
    '4000056655665556', // Visa test card
    '5555555555554444', // Mastercard test card
    '2223003122003222', // Mastercard test card
    '5200828282828210', // Mastercard test card
    '5105105105105100', // Mastercard test card
    '378282246310005',  // American Express test card
    '371449635398431',  // American Express test card
    '6011111111111117', // Discover test card
    '6011000990139424', // Discover test card
    '3056930009020004', // Diners Club test card
    '3566002020360505', // JCB test card
    '6200000000000005'  // UnionPay test card
  ];
}

console.log('✅ Encryption utility loaded successfully'); 