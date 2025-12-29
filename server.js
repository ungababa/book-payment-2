const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const stripe = require('stripe')(STRIPE_SECRET_KEY);

const ORDERS_FILE = path.join(__dirname, 'server', 'orders.json');

const app = express();
app.use(cors());
app.use(bodyParser.json());

function readOrders() {
  try {
    const raw = fs.readFileSync(ORDERS_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) {
    return [];
  }
}

function writeOrders(arr) {
  fs.mkdirSync(path.join(__dirname, 'server'), { recursive: true });
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(arr, null, 2));
}

function calculateShipping(country, quantity) {
  const q = Number(quantity) || 1;
  const rates = {
    HK: {1: 2000, 2: 2500, 3: 5000, 4: 5000, default: 7000},
    Mainland: {1: 2500, 2: 4000, 3: 7000, 4: 7000, default: 10000},
    Taiwan: {1: 2500, 2: 4000, 3: 7000, 4: 7000, default: 10000},
    Other: {1: 3000, 2: 5000, 3: 8000, 4: 8000, default: 12000}
  };
  const key = country === 'HK' || country === 'Hong Kong' ? 'HK'
    : (country === 'Mainland' || country === 'China' || country === 'Mainland China') ? 'Mainland'
    : (country === 'Taiwan') ? 'Taiwan'
    : 'Other';
  const tier = rates[key][q] || rates[key].default;
  return tier;
}

app.post('/calculate-shipping', (req, res) => {
  const { country, quantity } = req.body || {};
  const shipping = calculateShipping(country, quantity);
  res.json({ shipping });
});

app.post('/create-checkout-session', async (req, res) => {
  try {
    const body = req.body || {};
    const { fullname, address, city, country, email, quantity = 1, isPreorder } = body;
    const UNIT_PRICE = isPreorder ? 92 : 115; // HKD
    const PACKAGING_FEE = 10; // HKD

    const subtotal = Math.max(0, Math.floor(Number(quantity) || 1) * UNIT_PRICE);
    const packaging = PACKAGING_FEE;
    const shipping = calculateShipping(country, quantity) / 100; // shipping returned in cents
    const totalHKD = subtotal + packaging + shipping;
    const amount = Math.round(totalHKD * 100); // in cents

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'hkd',
      receipt_email: email,
      metadata: {
        fullname, address, city, country, quantity: String(quantity), isPreorder: String(!!isPreorder)
      }
    });

    // create order object and save
    const orders = readOrders();
    const orderId = `ORD-${Date.now()}-${Math.floor(Math.random()*9000)+1000}`;
    const order = {
      id: orderId,
      fullname, address, city, country, email,
      quantity, isPreorder: !!isPreorder,
      timestamp: Date.now(),
      status: 'pending',
      subtotal: Math.round(subtotal * 100),
      packagingFee: Math.round(packaging * 100),
      shippingFee: Math.round(shipping * 100),
      total: amount,
      payment_intent: paymentIntent.id
    };
    orders.push(order);
    writeOrders(orders);

    res.json({ clientSecret: paymentIntent.client_secret, orderId, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/payment-status', (req, res) => {
  const { orderId, payment_intent } = req.query;
  const orders = readOrders();
  const order = orders.find(o => (orderId && o.id === orderId) || (payment_intent && o.payment_intent === payment_intent));
  if (!order) return res.json({ status: 'not_found' });
  res.json({ status: order.status, order });
});

// Optional webhook endpoint to update order status (set STRIPE_WEBHOOK_SECRET to enable signature verification)
app.post('/webhook', bodyParser.raw({type: 'application/json'}), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event = null;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = req.body;
    }
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const type = event.type || (event.type && event.type.name) || 'unknown';

  if (type === 'payment_intent.succeeded' || (event.type === 'payment_intent.succeeded')) {
    const pi = event.data.object;
    const orders = readOrders();
    const idx = orders.findIndex(o => o.payment_intent === pi.id);
    if (idx >= 0) {
      orders[idx].status = 'paid';
      writeOrders(orders);
    }
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
