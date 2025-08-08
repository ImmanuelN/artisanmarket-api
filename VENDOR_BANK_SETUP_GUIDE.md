# Vendor Bank Account Setup Guide

## Overview
This guide explains how to set up bank accounts for vendors to receive payments through Plaid integration.

## 🏗️ Architecture

### Backend Components
1. **Vendor Model** - Stores bank account information and Plaid tokens
2. **Vendor Bank Routes** - API endpoints for bank account management
3. **Plaid Integration** - Secure bank account linking and transfers

### Frontend Components (to be implemented)
1. **Bank Account Setup Form** - Plaid Link integration
2. **Vendor Dashboard** - View balance and manage payouts
3. **Payout History** - Track payment history

## 🔧 API Endpoints

### 1. Create Plaid Link Token
```http
POST /api/vendor-bank/create-link-token
Authorization: Bearer <vendor_token>
```

**Response:**
```json
{
  "success": true,
  "linkToken": "link-sandbox-123..."
}
```

### 2. Setup Bank Account
```http
POST /api/vendor-bank/setup-bank-account
Authorization: Bearer <vendor_token>
Content-Type: application/json

{
  "publicToken": "public-sandbox-123...",
  "accountId": "account-123..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Bank account setup completed successfully",
  "account": {
    "name": "Plaid Checking",
    "mask": "0000",
    "type": "checking",
    "bankName": "ins_123456"
  }
}
```

### 3. Get Bank Account Info
```http
GET /api/vendor-bank/bank-account
Authorization: Bearer <vendor_token>
```

**Response:**
```json
{
  "success": true,
  "bankAccount": {
    "isConnected": true,
    "payoutMethod": "bank_transfer",
    "bankAccount": {
      "accountNumber": "0000",
      "accountHolderName": "Vendor Name",
      "bankName": "Bank Name",
      "accountType": "checking"
    },
    "lastSync": "2024-01-15T10:30:00.000Z"
  }
}
```

### 4. Simulate Payout
```http
POST /api/vendor-bank/simulate-payout
Authorization: Bearer <vendor_token>
Content-Type: application/json

{
  "amount": 150.00,
  "description": "Monthly payout"
}
```

### 5. Get Financial Summary
```http
GET /api/vendor-bank/financial-summary
Authorization: Bearer <vendor_token>
```

**Response:**
```json
{
  "success": true,
  "financials": {
    "balance": 500.00,
    "pendingBalance": 0.00,
    "totalEarnings": 1500.00,
    "commissionRate": 0.15,
    "payoutMethod": "bank_transfer",
    "isBankConnected": true
  }
}
```

## 🚀 Implementation Steps

### Step 1: Environment Setup
1. **Plaid Account**: Sign up for a Plaid account
2. **Environment Variables**: Add to your `.env` file:
   ```env
   PLAID_CLIENT_ID=your_plaid_client_id
   PLAID_SECRET=your_plaid_secret
   PLAID_ENV=sandbox  # or development/production
   ```

### Step 2: Frontend Integration

#### Install Plaid Link
```bash
npm install react-plaid-link
```

#### Create Bank Account Setup Component
```jsx
import React, { useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';

const BankAccountSetup = () => {
  const [linkToken, setLinkToken] = useState(null);

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: async (public_token, metadata) => {
      // Handle successful bank account linking
      await setupBankAccount(public_token, metadata.accounts[0].id);
    },
  });

  const createLinkToken = async () => {
    const response = await fetch('/api/vendor-bank/create-link-token', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();
    setLinkToken(data.linkToken);
  };

  const setupBankAccount = async (publicToken, accountId) => {
    const response = await fetch('/api/vendor-bank/setup-bank-account', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ publicToken, accountId }),
    });
    // Handle response
  };

  return (
    <div>
      <button onClick={createLinkToken} disabled={!ready}>
        Connect Bank Account
      </button>
      {linkToken && (
        <button onClick={() => open()} disabled={!ready}>
          Open Plaid Link
        </button>
      )}
    </div>
  );
};
```

### Step 3: Vendor Dashboard
Create a dashboard for vendors to:
- View their current balance
- See connected bank account
- Request payouts
- View payout history

## 💰 Payout Flow

### 1. Automatic Payouts
- Set up scheduled payouts (weekly/monthly)
- Check vendor balance before payout
- Create ACH transfer via Plaid
- Update vendor balance
- Send confirmation email

### 2. Manual Payouts
- Vendor requests payout from dashboard
- Admin approves payout
- Process transfer
- Update balance

## 🔒 Security Considerations

### 1. Token Storage
- Encrypt Plaid access tokens before storing
- Use environment variables for sensitive data
- Implement token rotation

### 2. Access Control
- Verify vendor ownership before operations
- Implement rate limiting
- Log all financial transactions

### 3. Data Protection
- Mask account numbers in responses
- Implement audit trails
- Follow PCI compliance guidelines

## 🧪 Testing

### Sandbox Testing
1. Use Plaid's sandbox environment
2. Test with sample bank accounts
3. Verify error handling
4. Test payout simulations

### Production Testing
1. Use Plaid's development environment
2. Test with real bank accounts
3. Verify webhook handling
4. Test actual transfers

## 📊 Monitoring

### Key Metrics
- Payout success rate
- Transfer processing time
- Error rates
- Vendor satisfaction

### Alerts
- Failed transfers
- Low vendor balances
- API errors
- Security events

## 🚨 Error Handling

### Common Errors
1. **Insufficient Balance**: Vendor doesn't have enough funds
2. **Bank Account Not Connected**: Vendor needs to set up bank account
3. **Transfer Failed**: Plaid transfer failed
4. **Invalid Credentials**: Plaid tokens expired

### Error Responses
```json
{
  "success": false,
  "message": "Insufficient balance for payout",
  "error": "BALANCE_INSUFFICIENT"
}
```

## 📝 Next Steps

1. **Frontend Development**: Create React components for bank setup
2. **Dashboard**: Build vendor financial dashboard
3. **Automation**: Set up automated payout scheduling
4. **Monitoring**: Implement comprehensive logging and alerts
5. **Testing**: Create comprehensive test suite
6. **Documentation**: Add API documentation
7. **Security**: Implement encryption and audit trails

## 🔗 Resources

- [Plaid Documentation](https://plaid.com/docs/)
- [Plaid Link React](https://github.com/plaid/react-plaid-link)
- [ACH Transfer Guide](https://plaid.com/docs/transfer/)
- [Security Best Practices](https://plaid.com/docs/security/) 