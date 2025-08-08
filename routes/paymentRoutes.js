import express from 'express';
import Stripe from 'stripe';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { body, validationResult } from 'express-validator';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2023-10-16',
});

// Check if Stripe credentials are properly configured
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('⚠️  Stripe secret key not found. Using test key. Please set STRIPE_SECRET_KEY environment variable.');
}

// Initialize Plaid
const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID || 'test_client_id',
      'PLAID-SECRET': process.env.PLAID_SECRET || 'test_secret',
    },
  },
});

const plaidClient = new PlaidApi(plaidConfig);

// Check if Plaid credentials are properly configured
if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
  console.warn('⚠️  Plaid credentials not found. Using test credentials. Please set PLAID_CLIENT_ID and PLAID_SECRET environment variables.');
}

// Create payment intent for Stripe
router.post('/create-payment-intent', 
  requireAuth,
  [
    body('amount').isNumeric().withMessage('Amount must be a number'),
    body('currency').optional().isString().withMessage('Currency must be a string'),
    body('metadata').optional().isObject().withMessage('Metadata must be an object'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { amount, currency = 'usd', metadata = {} } = req.body;

      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency,
        metadata: {
          userId: req.user.id,
          ...metadata
        },
        automatic_payment_methods: {
          enabled: true,
        },
      });

      res.json({
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      });
    } catch (error) {
      console.error('Error creating payment intent:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create payment intent',
        error: error.message
      });
    }
  }
);

// Create Plaid link token for bank account setup
router.post('/create-link-token',
  requireAuth,
  async (req, res) => {
    try {
      const { userId } = req.body;
      
      const request = {
        user: { client_user_id: userId || req.user.id || 'default_user' },
        client_name: 'ArtisanMarket',
        products: ['auth', 'transfer'],
        country_codes: ['US'],
        language: 'en',
        account_filters: {
          depository: {
            account_subtypes: ['checking', 'savings']
          }
        }
      };

      console.log('Creating Plaid link token with request:', request);
      const createTokenResponse = await plaidClient.linkTokenCreate(request);
      
      res.json({
        success: true,
        linkToken: createTokenResponse.data.link_token
      });
    } catch (error) {
      console.error('Error creating link token:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create link token',
        error: error.message
      });
    }
  }
);

// Exchange public token for access token
router.post('/exchange-token',
  requireAuth,
  [
    body('publicToken').isString().withMessage('Public token is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { publicToken } = req.body;

      const exchangeResponse = await plaidClient.itemPublicTokenExchange({
        public_token: publicToken
      });

      // Store access token securely (you might want to encrypt this)
      const accessToken = exchangeResponse.data.access_token;

      res.json({
        success: true,
        accessToken,
        itemId: exchangeResponse.data.item_id
      });
    } catch (error) {
      console.error('Error exchanging token:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to exchange token',
        error: error.message
      });
    }
  }
);

// Get bank account information
router.post('/get-accounts',
  requireAuth,
  [
    body('accessToken').isString().withMessage('Access token is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { accessToken } = req.body;

      const accountsResponse = await plaidClient.accountsGet({
        access_token: accessToken
      });

      res.json({
        success: true,
        accounts: accountsResponse.data.accounts
      });
    } catch (error) {
      console.error('Error getting accounts:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get accounts',
        error: error.message
      });
    }
  }
);

// Create bank transfer
router.post('/create-transfer',
  requireAuth,
  [
    body('accessToken').isString().withMessage('Access token is required'),
    body('accountId').isString().withMessage('Account ID is required'),
    body('amount').isNumeric().withMessage('Amount must be a number'),
    body('description').isString().withMessage('Description is required'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { accessToken, accountId, amount, description } = req.body;

      // First, create a transfer authorization
      const authResponse = await plaidClient.transferAuthorizationCreate({
        access_token: accessToken,
        account_id: accountId,
        type: 'debit',
        network: 'ach',
        amount: amount.toString(),
        ach_class: 'ppd',
        user: {
          legal_name: req.user.name || 'User',
          email_address: req.user.email,
          address: {
            street: '123 Main St',
            city: 'San Francisco',
            state: 'CA',
            zip: '94053',
            country: 'US'
          }
        }
      });

      // Then create the transfer
      const transferResponse = await plaidClient.transferCreate({
        access_token: accessToken,
        account_id: accountId,
        authorization_id: authResponse.data.authorization.id,
        type: 'debit',
        network: 'ach',
        amount: amount.toString(),
        description,
        ach_class: 'ppd',
        user: {
          legal_name: req.user.name || 'User',
          email_address: req.user.email,
          address: {
            street: '123 Main St',
            city: 'San Francisco',
            state: 'CA',
            zip: '94053',
            country: 'US'
          }
        }
      });

      res.json({
        success: true,
        transfer: transferResponse.data.transfer
      });
    } catch (error) {
      console.error('Error creating transfer:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create transfer',
        error: error.message
      });
    }
  }
);

// Stripe webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('Payment succeeded:', paymentIntent.id);
      // Update order status, send confirmation email, etc.
      break;
    
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log('Payment failed:', failedPayment.id);
      // Handle failed payment
      break;
    
    case 'charge.succeeded':
      const charge = event.data.object;
      console.log('Charge succeeded:', charge.id);
      break;
    
    case 'charge.failed':
      const failedCharge = event.data.object;
      console.log('Charge failed:', failedCharge.id);
      break;
    
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

// Get payment methods for a customer
router.get('/payment-methods/:customerId',
  requireAuth,
  async (req, res) => {
    try {
      const { customerId } = req.params;
      
      const paymentMethods = await stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });

      res.json({
        success: true,
        paymentMethods: paymentMethods.data
      });
    } catch (error) {
      console.error('Error getting payment methods:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get payment methods',
        error: error.message
      });
    }
  }
);

// Create a customer
router.post('/create-customer',
  requireAuth,
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('name').optional().isString().withMessage('Name must be a string'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { email, name } = req.body;

      const customer = await stripe.customers.create({
        email,
        name,
        metadata: {
          userId: req.user.id
        }
      });

      res.json({
        success: true,
        customer
      });
    } catch (error) {
      console.error('Error creating customer:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create customer',
        error: error.message
      });
    }
  }
);

export default router;
