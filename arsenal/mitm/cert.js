/**
 * Root CA + per-host leaf certificate generation and OS trust store installation.
 *
 * Uses Node.js built-in `crypto` and `tls` — no external dependencies.
 * For actual X.509 DER encoding we use a minimal pure-JS implementation
 * sufficient for self-signed certificates.
 *
 * Windows: installs into CurrentUser\Root (no UAC needed in most cases)
 * macOS:   uses `security add-trusted-cert`
 * Linux:   copies to /usr/local/share/ca-certificates/ + update-ca-certificates
 */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

// ---------------------------------------------------------------------------
// ASN.1 / DER helpers — minimal subset needed for X.509 self-signed certs
// ---------------------------------------------------------------------------

function encodeLength(len) {
  if (len < 128) return Buffer.from([len]);
  if (len < 256) return Buffer.from([0x81, len]);
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function tlv(tag, value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([Buffer.from([tag]), encodeLength(buf.length), buf]);
}

function seq(children) {
  return tlv(0x30, Buffer.concat(children.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))));
}

function oid(hex) {
  return tlv(0x06, Buffer.from(hex, "hex"));
}

function utf8String(s) {
  return tlv(0x0c, Buffer.from(s, "utf8"));
}

function bitString(buf, unusedBits = 0) {
  return tlv(0x03, Buffer.concat([Buffer.from([unusedBits]), buf]));
}

function integer(buf) {
  // Ensure positive (prepend 0x00 if high bit set)
  if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0x00]), buf]);
  return tlv(0x02, buf);
}

function octetString(buf) {
  return tlv(0x04, buf);
}

function contextTag(n, constructed, value) {
  const tag = (constructed ? 0xa0 : 0x80) | (n & 0x1f);
  return tlv(tag, value);
}

// OIDs (hex-encoded, without the 0x06 tag)
const OID_RSA           = "2a864886f70d010101"; // rsaEncryption
const OID_SHA256_RSA    = "2a864886f70d01010b"; // sha256WithRSAEncryption
const OID_COMMON_NAME   = "5504030c";
const OID_ORG           = "55040a0c";
const OID_BASIC_CONSTR  = "55 1d 13".replace(/ /g, "");
const OID_KEY_USAGE     = "55 1d 0f".replace(/ /g, "");
const OID_SAN           = "55 1d 11".replace(/ /g, "");
const OID_EXT_KEY_USAGE = "55 1d 25".replace(/ /g, "");

// EKU OIDs
const OID_EKU_SERVER    = "2b06010505070301";
const OID_EKU_CLIENT    = "2b06010505070302";

function encodeRdn(oidHex, value) {
  return seq([seq([oid(oidHex), utf8String(value)])]);
}

function encodeX501Name(cn, org) {
  const parts = [encodeRdn(OID_COMMON_NAME, cn)];
  if (org) parts.push(encodeRdn(OID_ORG, org));
  // Wrap each in a SET
  return seq(parts.map((rdn) => tlv(0x31, rdn)));
}

function encodeTime(date) {
  // UTCTime: YYMMDDHHMMSSZ (for years 2000-2049)
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const d = date;
  const s =
    pad(d.getUTCFullYear() % 100) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z";
  return tlv(0x17, Buffer.from(s, "ascii"));
}

function encodeValidity(notBefore, notAfter) {
  return seq([encodeTime(notBefore), encodeTime(notAfter)]);
}

function buildExtensionsBlock(extensions) {
  return contextTag(3, true, seq([seq(extensions)]));
}

function encodeExtension(oidHex, critical, valueBytes) {
  const parts = [oid(oidHex)];
  if (critical) parts.push(Buffer.from([0x01, 0x01, 0xff]));
  parts.push(octetString(valueBytes));
  return seq(parts);
}

/**
 * Generate a self-signed Root CA key pair + certificate.
 * @returns {{ keyPem: string, certPem: string, certDer: Buffer }}
 */
function generateRootCa() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });

  const keyPem = privateKey.export({ type: "pkcs1", format: "pem" });
  const pubKeyDer = publicKey.export({ type: "pkcs1", format: "der" });

  const now = new Date();
  const notBefore = new Date(now.getTime() - 60000); // 1 min ago
  const notAfter  = new Date(now.getTime() + 10 * 365 * 24 * 3600 * 1000); // 10 years

  const serialBuf = crypto.randomBytes(16);
  serialBuf[0] &= 0x7f; // ensure positive

  const subject = encodeX501Name("Nutaan Code MITM Root CA", "Nutaan Code");

  // SubjectPublicKeyInfo
  const spki = seq([
    seq([oid(OID_RSA), Buffer.from([0x05, 0x00])]),
    bitString(pubKeyDer),
  ]);

  // Extensions
  const basicConstraints = encodeExtension(
    OID_BASIC_CONSTR,
    true,
    seq([Buffer.from([0x01, 0x01, 0xff])]) // cA: TRUE
  );
  const keyUsage = encodeExtension(
    OID_KEY_USAGE,
    true,
    // keyCertSign + cRLSign = bits 5 + 6
    Buffer.from([0x03, 0x02, 0x01, 0x06])
  );

  const tbsCert = seq([
    contextTag(0, true, integer(Buffer.from([0x02]))), // version 3
    integer(serialBuf),
    seq([oid(OID_SHA256_RSA), Buffer.from([0x05, 0x00])]),
    subject, // issuer = subject for CA
    encodeValidity(notBefore, notAfter),
    subject,
    spki,
    buildExtensionsBlock([basicConstraints, keyUsage]),
  ]);

  // Sign the TBSCertificate
  const sign = crypto.createSign("SHA256");
  sign.update(tbsCert);
  const sigDer = sign.sign(privateKey);

  const certDer = seq([
    tbsCert,
    seq([oid(OID_SHA256_RSA), Buffer.from([0x05, 0x00])]),
    bitString(sigDer),
  ]);

  const certPem =
    "-----BEGIN CERTIFICATE-----\n" +
    certDer.toString("base64").match(/.{1,64}/g).join("\n") +
    "\n-----END CERTIFICATE-----\n";

  return { keyPem, certPem, certDer };
}

/**
 * Generate a leaf TLS certificate for a given hostname, signed by the root CA.
 *
 * @param {string} hostname
 * @param {{ keyPem: string, certDer: Buffer }} ca
 * @returns {{ keyPem: string, certPem: string }}
 */
function generateLeafCert(hostname, ca) {
  const { privateKey: leafKey, publicKey: leafPub } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });

  const caKey = crypto.createPrivateKey(ca.keyPem);
  const leafKeyPem = leafKey.export({ type: "pkcs1", format: "pem" });
  const leafPubDer  = leafPub.export({ type: "pkcs1", format: "der" });

  const now = new Date();
  const notBefore = new Date(now.getTime() - 60000);
  const notAfter  = new Date(now.getTime() + 398 * 24 * 3600 * 1000); // ~13 months

  const serialBuf = crypto.randomBytes(16);
  serialBuf[0] &= 0x7f;

  // Parse issuer from CA cert (simplified: reuse constant)
  const issuer  = encodeX501Name("Nutaan Code MITM Root CA", "Nutaan Code");
  const subject = encodeX501Name(hostname, "Nutaan Code MITM");

  const spki = seq([
    seq([oid(OID_RSA), Buffer.from([0x05, 0x00])]),
    bitString(leafPubDer),
  ]);

  // SAN extension — DNS name
  const dnsNameBuf = Buffer.from(hostname, "utf8");
  const sanContent = seq([tlv(0x82, dnsNameBuf)]); // [2] dNSName
  const sanExt = encodeExtension(OID_SAN, false, sanContent);

  const basicConstraints = encodeExtension(
    OID_BASIC_CONSTR,
    true,
    seq([]) // cA: FALSE (no boolean = FALSE per DER)
  );

  const ekuContent = seq([oid(OID_EKU_SERVER), oid(OID_EKU_CLIENT)]);
  const ekuExt = encodeExtension(OID_EXT_KEY_USAGE, false, ekuContent);

  const tbsCert = seq([
    contextTag(0, true, integer(Buffer.from([0x02]))), // version 3
    integer(serialBuf),
    seq([oid(OID_SHA256_RSA), Buffer.from([0x05, 0x00])]),
    issuer,
    encodeValidity(notBefore, notAfter),
    subject,
    spki,
    buildExtensionsBlock([basicConstraints, sanExt, ekuExt]),
  ]);

  const sign = crypto.createSign("SHA256");
  sign.update(tbsCert);
  const sigDer = sign.sign(caKey);

  const certDer = seq([
    tbsCert,
    seq([oid(OID_SHA256_RSA), Buffer.from([0x05, 0x00])]),
    bitString(sigDer),
  ]);

  const certPem =
    "-----BEGIN CERTIFICATE-----\n" +
    certDer.toString("base64").match(/.{1,64}/g).join("\n") +
    "\n-----END CERTIFICATE-----\n";

  return { keyPem: leafKeyPem, certPem };
}

/**
 * Install a PEM root CA certificate into the OS trust store.
 *
 * @param {string} certPath - Path to the CA .crt file
 * @returns {{ installed: boolean, reason?: string }}
 */
function installRootCa(certPath) {
  const platform = process.platform;

  try {
    if (platform === "win32") {
      // CurrentUser\Root — usually no UAC needed
      const r = spawnSync(
        "powershell",
        [
          "-NonInteractive",
          "-Command",
          `Import-Certificate -FilePath '${certPath}' -CertStoreLocation Cert:\\CurrentUser\\Root`,
        ],
        { encoding: "utf8", timeout: 15000 }
      );
      if (r.status !== 0) {
        return { installed: false, reason: (r.stderr || r.stdout || "").trim() };
      }
      return { installed: true };
    }

    if (platform === "darwin") {
      const keychain = path.join(os.homedir(), "Library", "Keychains", "login.keychain-db");
      const r = spawnSync(
        "security",
        ["add-trusted-cert", "-d", "-r", "trustRoot", "-k", keychain, certPath],
        { encoding: "utf8", timeout: 15000 }
      );
      if (r.status !== 0) {
        return { installed: false, reason: (r.stderr || r.stdout || "").trim() };
      }
      return { installed: true };
    }

    // Linux — try update-ca-certificates
    const destDir = "/usr/local/share/ca-certificates";
    const destPath = path.join(destDir, "nutaan-mitm.crt");
    try {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(certPath, destPath);
      spawnSync("update-ca-certificates", [], { encoding: "utf8", timeout: 15000 });
      return { installed: true };
    } catch (e) {
      return { installed: false, reason: String(e.message) };
    }
  } catch (err) {
    return { installed: false, reason: String(err.message) };
  }
}

/**
 * Remove the Nutaan MITM root CA from the OS trust store.
 * @returns {{ removed: boolean, reason?: string }}
 */
function uninstallRootCa() {
  const platform = process.platform;
  try {
    if (platform === "win32") {
      const r = spawnSync(
        "powershell",
        [
          "-NonInteractive",
          "-Command",
          `Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { $_.Subject -like '*Nutaan Code MITM*' } | Remove-Item`,
        ],
        { encoding: "utf8", timeout: 15000 }
      );
      return { removed: r.status === 0 };
    }
    if (platform === "darwin") {
      const r = spawnSync(
        "security",
        ["delete-certificate", "-c", "Nutaan Code MITM Root CA"],
        { encoding: "utf8", timeout: 15000 }
      );
      return { removed: r.status === 0 };
    }
    // Linux
    const destPath = "/usr/local/share/ca-certificates/nutaan-mitm.crt";
    try {
      fs.unlinkSync(destPath);
      spawnSync("update-ca-certificates", [], { encoding: "utf8", timeout: 15000 });
    } catch { /* ignore */ }
    return { removed: true };
  } catch (err) {
    return { removed: false, reason: String(err.message) };
  }
}

/**
 * Check if the Nutaan MITM root CA is currently trusted in the OS store.
 * @returns {boolean}
 */
function isRootCaTrusted() {
  const platform = process.platform;
  try {
    if (platform === "win32") {
      const r = spawnSync(
        "powershell",
        ["-NonInteractive", "-Command",
          `(Get-ChildItem Cert:\\CurrentUser\\Root | Where-Object { $_.Subject -like '*Nutaan Code MITM*' }).Count`],
        { encoding: "utf8", timeout: 10000 }
      );
      return parseInt((r.stdout || "").trim(), 10) > 0;
    }
    if (platform === "darwin") {
      const r = spawnSync(
        "security",
        ["find-certificate", "-c", "Nutaan Code MITM Root CA"],
        { encoding: "utf8", timeout: 10000 }
      );
      return r.status === 0;
    }
    return fs.existsSync("/usr/local/share/ca-certificates/nutaan-mitm.crt");
  } catch {
    return false;
  }
}

module.exports = { generateRootCa, generateLeafCert, installRootCa, uninstallRootCa, isRootCaTrusted };
