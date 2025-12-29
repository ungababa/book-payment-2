// ============================================
// MatheMagic Book - JavaScript Frontend App (Stripe Elements + Backend)
// ============================================

const UNIT_PRICE = 92; // HKD
const REGULAR_PRICE = 115; // HKD
const STRIPE_PUBLIC_KEY = 'pk_test_51SXfkkPQ4EySkFTOckjbrjtUrhwKnMyeiMLboj6bCPo6k9CvcFJ2Tq9X9uH5GcVl4SghyTAFot87WEkSWPah7wmO00crSmfMDQ';

// Backend URL - change this to your deployed backend when ready
const BACKEND_URL = (location.hostname === 'localhost') ? 'http://localhost:4242' : location.origin;

// Shipping rates (in HKD cents)
const SHIPPING_RATES = {
    HK: {1: 2000, 2: 2500, 3: 5000, 4: 5000, default: 7000},
    Mainland: {1: 2500, 2: 4000, 3: 7000, 4: 7000, default: 10000},
    Taiwan: {1: 2500, 2: 4000, 3: 7000, 4: 7000, default: 10000},
    Other: {1: 3000, 2: 5000, 3: 8000, 4: 8000, default: 12000}
};

const PACKAGING_FEE = 1000; // HK$10 in cents

let stripe, elements, card;
let demoMode = false; // try real payments by default; fallback to demo if backend fails

document.addEventListener('DOMContentLoaded', async () => {
    stripe = Stripe(STRIPE_PUBLIC_KEY);

    // Initialize Elements
    elements = stripe.elements();
    const style = {
        base: { color: '#30313D', fontFamily: 'Segoe UI, Tahoma, sans-serif', fontSize: '16px' },
        invalid: { color: '#fa755a' }
    };
    card = elements.create('card', { style });
    try {
        card.mount('#payment-element');
    } catch (err) {
        // If mount fails, we'll fall back to demo
        console.warn('Stripe Elements mount failed:', err);
        demoMode = true;
    }

    // Get form elements
    const form = document.getElementById('payment-form');
    const quantityInput = document.getElementById('quantity');
    const countryInput = document.getElementById('country');
    const preorderCheckbox = document.getElementById('preorder');
    const emailInput = document.getElementById('email');
    const demoNotice = document.getElementById('demo-notice');

    // Hide demo notice by default
    demoNotice.style.display = 'none';

    // Add event listeners
    quantityInput.addEventListener('change', updateBreakdown);
    countryInput.addEventListener('change', updateBreakdown);
    preorderCheckbox.addEventListener('change', updateBreakdown);
    form.addEventListener('submit', handleSubmit);
    emailInput.addEventListener('input', () => {
        document.getElementById('email-errors').textContent = '';
        emailInput.classList.remove('error');
    });

    // Initial breakdown
    updateBreakdown();
});

// Calculate shipping fee based on country and quantity
function calculateShipping(country, quantity) {
    const rates = SHIPPING_RATES[country] || SHIPPING_RATES.Other;
    if (quantity === 1) return rates[1];
    if (quantity === 2) return rates[2];
    if (quantity <= 4) return rates[3];
    return rates.default;
}

// Update breakdown display
function updateBreakdown() {
    const quantity = Math.max(1, Math.min(99, parseInt(document.getElementById('quantity').value) || 1));
    const country = document.getElementById('country').value || 'HK';
    const isPreorder = document.getElementById('preorder').checked;

    const unitPrice = isPreorder ? UNIT_PRICE : REGULAR_PRICE;
    const subtotal = unitPrice * quantity * 100; // cents
    const packagingFee = PACKAGING_FEE;
    const shippingFee = calculateShipping(country, quantity);
    const total = subtotal + packagingFee + shippingFee;

    // Update display values
    document.getElementById('price-display').textContent = `HK$${unitPrice}`;
    document.getElementById('qty-display').textContent = quantity;
    document.getElementById('country-display').textContent = country;

    document.getElementById('subtotal').textContent = (subtotal / 100).toFixed(2);
    document.getElementById('packaging').textContent = (packagingFee / 100).toFixed(2);
    document.getElementById('shipping').textContent = (shippingFee / 100).toFixed(2);
    document.getElementById('total').textContent = (total / 100).toFixed(2);

    document.getElementById('button-text').textContent = `Complete Order — HK$${(total / 100).toFixed(2)}`;
}

// Validate form
function validateForm() {
    const fullname = document.getElementById('fullname').value.trim();
    const address = document.getElementById('address').value.trim();
    const city = document.getElementById('city').value.trim();
    const country = document.getElementById('country').value;
    const email = document.getElementById('email').value.trim();

    const errors = [];
    if (!fullname) errors.push('Full name is required');
    if (!address) errors.push('Street address is required');
    if (!city) errors.push('City is required');
    if (!country) errors.push('Country is required');

    if (!email) {
        errors.push('Email is required');
        document.getElementById('email').classList.add('error');
    } else if (!isValidEmail(email)) {
        errors.push('Please enter a valid email address');
        document.getElementById('email').classList.add('error');
    }

    if (errors.length > 0) {
        showMessage(errors.join(', '), 'error');
        return false;
    }
    return true;
}

// Email validation helper
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Show message
function showMessage(text, type = 'error') {
    const messageEl = document.getElementById('payment-message');
    messageEl.textContent = text;
    messageEl.className = `message ${type}`;
}

// Handle form submission
async function handleSubmit(e) {
    e.preventDefault();
    if (!validateForm()) return;

    const submitBtn = document.getElementById('submit-btn');
    submitBtn.disabled = true;

    const fullname = document.getElementById('fullname').value.trim();
    const address = document.getElementById('address').value.trim();
    const city = document.getElementById('city').value.trim();
    const country = document.getElementById('country').value;
    const email = document.getElementById('email').value.trim();
    const quantity = parseInt(document.getElementById('quantity').value);
    const isPreorder = document.getElementById('preorder').checked;

    const order = {
        id: generateOrderId(),
        fullname, address, city, country, email,
        quantity, isPreorder, timestamp: Date.now(), demo: false
    };

    // Calculate totals locally in cents
    const unitPrice = isPreorder ? UNIT_PRICE : REGULAR_PRICE;
    order.subtotal = unitPrice * quantity * 100;
    order.packagingFee = PACKAGING_FEE;
    order.shippingFee = calculateShipping(country, quantity);
    order.total = order.subtotal + order.packagingFee + order.shippingFee;

    // Attempt to create a PaymentIntent via backend
    try {
        const resp = await fetch(`${BACKEND_URL}/create-checkout-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullname, address, city, country, email, quantity, isPreorder })
        });

        if (!resp.ok) throw new Error('Backend error creating checkout session');
        const data = await resp.json();
        const clientSecret = data.clientSecret;
        const serverOrder = data.order || {};

        // Confirm the payment using Stripe Elements
        const result = await stripe.confirmCardPayment(clientSecret, {
            payment_method: {
                card,
                billing_details: { name: fullname, email }
            }
        });

        if (result.error) {
            showMessage(result.error.message || 'Payment failed', 'error');
            submitBtn.disabled = false;
            return;
        }

        if (result.paymentIntent && result.paymentIntent.status === 'succeeded') {
            // Save order locally and mark as completed
            order.status = 'Completed';
            order.payment_intent = result.paymentIntent.id;
            // Merge server-provided fields if present
            if (serverOrder.id) order.id = serverOrder.id;
            if (serverOrder.total) order.total = serverOrder.total;

            localStorage.setItem('lastOrder', JSON.stringify(order));
            const orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
            orderHistory.push(order);
            localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

            showMessage('✓ Payment successful — Redirecting to confirmation...', 'success');
            setTimeout(() => window.location.href = 'return.html', 1200);
            return;
        }

        // If we reach here, treat as failure
        showMessage('Payment not completed', 'error');
        submitBtn.disabled = false;
    } catch (err) {
        console.warn('Backend request failed, falling back to demo mode:', err);
        // Fallback to demo mode behavior (client-only)
        demoMode = true;
        document.getElementById('demo-notice').style.display = 'block';

        order.status = 'Completed (demo)';
        order.demo = true;
        localStorage.setItem('lastOrder', JSON.stringify(order));
        const orderHistory = JSON.parse(localStorage.getItem('orderHistory') || '[]');
        orderHistory.push(order);
        localStorage.setItem('orderHistory', JSON.stringify(orderHistory));

        showMessage('Demo order created locally. Redirecting...', 'success');
        setTimeout(() => window.location.href = 'return.html', 900);
    }
}

// Generate unique order ID
function generateOrderId() {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    return `ORD-${timestamp}-${random}`;
}

