
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, './.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

console.log('Testing connection to:', url);
console.log('Using key prefix:', key ? key.substring(0, 15) : 'MISSING');

async function test() {
    try {
        const res = await fetch(`${url}/rest/v1/folders?select=id&limit=1`, {
            headers: {
                'apikey': key,
                'Authorization': `Bearer ${key}`
            }
        });
        console.log('Status:', res.status);
        console.log('Status Text:', res.statusText);
        const text = await res.text();
        console.log('Response:', text);
    } catch (err) {
        console.error('Fetch Failed Error:', err);
        if (err.cause) {
            console.error('Cause:', err.cause);
        }
    }
}

test();
