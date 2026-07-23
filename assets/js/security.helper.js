
const localStorageKPBKey = 'alan-gpt-B';
const localStorageKRKey = 'alan-gpt-K';
const localStorageAliceKey = 'alan-gpt-a';
const localStorageKPAKey = 'alan-gpt-A';

const p = BigInt("0x" +
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD1" +
    "29024E088A67CC74020BBEA63B139B22514A08798E3404DD" +
    "EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245" +
    "E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED" +
    "EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3D" +
    "C2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F" +
    "83655D23DCA3AD961C62F356208552BB9ED529077096966D" +
    "670C354E4ABC9804F1746C08CA237327FFFFFFFFFFFFFFFF"
);

const g = 2n;
var secretKey = null;

function modPow(base, exponent, modulus) {
    base = BigInt(base);
    exponent = BigInt(exponent);
    modulus = BigInt(modulus);
    let result = 1n;
    base = base % modulus;

    while (exponent > 0) {
        if (exponent % 2n === 1n) {
            result = (result * base) % modulus;
        }
        exponent = exponent / 2n;
        base = (base * base) % modulus;
    }

    return result;
}

function generatePublic(a) {
    return modPow(g, a, p);
}

function computeSharedSecret(B, a) {
    return modPow(B, a, p);
}

function generatePrivateKey() {
    let privateKey = 0n;
    for (let i = 0; i < 32; i++) {
        const randomByte = Math.floor(Math.random() * 256);
        privateKey = (privateKey << 8n) | BigInt(randomByte);
    }
    return privateKey;
}

function securityValidate(onInvalid = 'logout') {
    const B = localStorage.getItem(localStorageKPBKey);
    const a = localStorage.getItem(localStorageAliceKey);
    if (!B || !a) {
        if (onInvalid == 'logout') {
            console.log(`${localStorageKPBKey}: ${B}, ${localStorageKRKey}: ${a}`);
            window.location.href = '/alan/sql_queriers/logout.php';
        }
    }
}

function initSecurityKey() {
    securityValidate();

    const B = localStorage.getItem(localStorageKPBKey);
    const a = localStorage.getItem(localStorageAliceKey);
    secretKey = computeSharedSecret(B, a);
}


function encryptData(data, dhKey) {
    const plaintext = typeof data === 'string' ? data : JSON.stringify(data);
    
    const keyString = dhKey.toString();
    const key = CryptoJS.SHA256(keyString);
    
    const iv = CryptoJS.lib.WordArray.random(16);
    
    const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });
    
    return {
        encrypted_data: encrypted.toString(),
        iv: iv.toString(CryptoJS.enc.Base64)
    };
}

function decryptData(encryptedData, iv, dhKey, returnArray = true) {
    const keyString = dhKey.toString();
    const key = CryptoJS.SHA256(keyString);
    
    const decrypted = CryptoJS.AES.decrypt(encryptedData, key, {
        iv: CryptoJS.enc.Base64.parse(iv),
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7
    });
    
    const decryptedText = decrypted.toString(CryptoJS.enc.Utf8);
    
    if (returnArray) {
        try {
            return JSON.parse(decryptedText);
        } catch (e) {
            return decryptedText;
        }
    }
    
    return decryptedText;
}

function generateHmac(data, dhKey) {
    const dataString = typeof data === 'string' ? data : JSON.stringify(data);
    const keyString = dhKey.toString();
    
    const hmac = CryptoJS.HmacSHA256(dataString, keyString);
    
    return hmac.toString(CryptoJS.enc.Hex);
}

function verifyIntegrity(data, hmac, dhKey) {
    const calculatedHmac = generateHmac(data, dhKey);
    
  
    return calculatedHmac === hmac;
}

function arrayBufferToBase64(buffer) {
    const wordArray = CryptoJS.lib.WordArray.create(buffer);
    return CryptoJS.enc.Base64.stringify(wordArray);
}

function base64ToArrayBuffer(base64) {
    const wordArray = CryptoJS.enc.Base64.parse(base64);
    
    const arrayBuffer = new ArrayBuffer(wordArray.sigBytes);
    const uint8Array = new Uint8Array(arrayBuffer);
    

    for (let i = 0; i < wordArray.sigBytes; i++) {
        uint8Array[i] = (wordArray.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
    }
    
    return arrayBuffer;
}

function arrayBufferToHex(buffer) {
    const wordArray = CryptoJS.lib.WordArray.create(buffer);
    return CryptoJS.enc.Hex.stringify(wordArray);
}