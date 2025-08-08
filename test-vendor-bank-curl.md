# Testing Vendor Bank Account Setup with cURL

## Prerequisites
1. Server running on `http://localhost:5000`
2. Vendor authentication token
3. Plaid credentials configured

## Test Commands

### 1. Create Plaid Link Token
```bash
curl -X POST http://localhost:5000/api/vendor-bank/create-link-token \
  -H "Authorization: Bearer YOUR_VENDOR_TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "success": true,
  "linkToken": "link-sandbox-123..."
}
```

### 2. Get Bank Account Information
```bash
curl -X GET http://localhost:5000/api/vendor-bank/bank-account \
  -H "Authorization: Bearer YOUR_VENDOR_TOKEN"
```

**Expected Response (if not connected):**
```json
{
  "success": true,
  "bankAccount": {
    "isConnected": false,
    "payoutMethod": "stripe",
    "bankAccount": null,
    "lastSync": null
  }
}
```

### 3. Get Financial Summary
```bash
curl -X GET http://localhost:5000/api/vendor-bank/financial-summary \
  -H "Authorization: Bearer YOUR_VENDOR_TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "financials": {
    "balance": 0.00,
    "pendingBalance": 0.00,
    "totalEarnings": 0.00,
    "commissionRate": 0.15,
    "payoutMethod": "stripe",
    "isBankConnected": false
  }
}
```

### 4. Simulate Payout (requires bank account setup)
```bash
curl -X POST http://localhost:5000/api/vendor-bank/simulate-payout \
  -H "Authorization: Bearer YOUR_VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 150.00,
    "description": "Monthly payout"
  }'
```

**Expected Response (if no bank account):**
```json
{
  "success": false,
  "message": "No bank account connected. Please set up a bank account first."
}
```

## Complete Flow Example

### Step 1: Get Link Token
```bash
TOKEN=$(curl -s -X POST http://localhost:5000/api/vendor-bank/create-link-token \
  -H "Authorization: Bearer YOUR_VENDOR_TOKEN" \
  -H "Content-Type: application/json" | jq -r '.linkToken')

echo "Link Token: $TOKEN"
```

### Step 2: Setup Bank Account (after Plaid Link completion)
```bash
curl -X POST http://localhost:5000/api/vendor-bank/setup-bank-account \
  -H "Authorization: Bearer YOUR_VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "publicToken": "public-sandbox-123...",
    "accountId": "account-123..."
  }'
```

### Step 3: Verify Setup
```bash
curl -X GET http://localhost:5000/api/vendor-bank/bank-account \
  -H "Authorization: Bearer YOUR_VENDOR_TOKEN"
```

### Step 4: Test Payout
```bash
curl -X POST http://localhost:5000/api/vendor-bank/simulate-payout \
  -H "Authorization: Bearer YOUR_VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100.00,
    "description": "Test payout"
  }'
```

## Error Testing

### Test with Invalid Token
```bash
curl -X GET http://localhost:5000/api/vendor-bank/bank-account \
  -H "Authorization: Bearer INVALID_TOKEN"
```

### Test with Non-Vendor User
```bash
curl -X GET http://localhost:5000/api/vendor-bank/bank-account \
  -H "Authorization: Bearer CUSTOMER_TOKEN"
```

### Test Insufficient Balance
```bash
curl -X POST http://localhost:5000/api/vendor-bank/simulate-payout \
  -H "Authorization: Bearer YOUR_VENDOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10000.00,
    "description": "Large payout"
  }'
```

## Notes
- Replace `YOUR_VENDOR_TOKEN` with actual vendor JWT token
- The Plaid integration requires proper credentials in `.env`
- Bank account setup requires frontend Plaid Link integration
- Payout simulation works in test mode without real transfers 