/**
 * did:webplus Generator for Archon Protocol
 * Generates did-documents.jsonl microledger from did:cid identifiers
 * 
 * Updated to match did:webplus spec v2 (March 2026):
 * - updateRules field for authorization
 * - proofs array (JWS format) instead of selfSignature fields
 * - kid field in publicKeyJwk with full DID + query params
 * - verificationMethod[].id includes selfHash and versionId query params
 */

import * as crypto from 'crypto';

export interface WebplusDocument {
  id: string;
  selfHash: string;
  prevDIDDocumentSelfHash?: string;
  updateRules: {
    hashedKey?: string;  // For root document
    key?: string;        // For subsequent updates
  };
  proofs?: string[];     // JWS compact serialization
  validFrom: string;
  versionId: number;
  verificationMethod: WebplusVerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  keyAgreement?: string[];
  capabilityInvocation: string[];
  capabilityDelegation?: string[];
  service?: any[];
  alsoKnownAs?: string[];
}

export interface WebplusVerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyJwk: {
    kid: string;
    kty: string;
    crv: string;
    x: string;
    y?: string;  // For EC keys
  };
}

export interface WebplusFiles {
  microledger: WebplusDocument[];
  microledgerJsonl: string;
  did: string;
  latestDocument: WebplusDocument;
}

const DEFAULT_GATEKEEPER = process.env.ARCHON_GATEKEEPER_URL || 'https://archon.technology';

/**
 * Extract the AID (bare identifier) from a did:cid
 */
export function extractAid(didCid: string): string {
  if (didCid.startsWith('did:cid:')) {
    return didCid.slice(8);
  }
  return didCid;
}

/**
 * Construct a did:webplus identifier
 * The root-self-hash is the CID from the did:cid
 */
export function constructWebplusDid(host: string, path: string | null, rootSelfHash: string): string {
  // Encode port colons as %3A per spec
  const encodedHost = host.replace(/:/g, '%3A');
  if (path) {
    return `did:webplus:${encodedHost}:${path}:${rootSelfHash}`;
  }
  return `did:webplus:${encodedHost}:${rootSelfHash}`;
}

/**
 * Get the resolution URL for a did:webplus
 */
export function getResolutionUrl(did: string): string {
  // Drop did:webplus: prefix
  let url = did.slice(12);
  // Replace : with /
  url = url.replace(/:/g, '/');
  // Percent-decode
  url = decodeURIComponent(url);
  // Append /did-documents.jsonl
  url = url + '/did-documents.jsonl';
  // Add https:// (or http:// for localhost)
  if (url.startsWith('localhost')) {
    url = 'http://' + url;
  } else {
    url = 'https://' + url;
  }
  return url;
}

/**
 * Fetch DID document and metadata from gatekeeper
 */
async function fetchDidData(didCid: string, gatekeeperUrl: string = DEFAULT_GATEKEEPER): Promise<any> {
  const url = `${gatekeeperUrl}/api/v1/did/${didCid}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch DID: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Hash a public key for updateRules.hashedKey
 * Uses SHA-256 with base64url multibase encoding
 */
function hashPublicKey(publicKeyJwk: any): string {
  const keyBytes = JSON.stringify(publicKeyJwk);
  const hash = crypto.createHash('sha256').update(keyBytes).digest();
  // base64url multibase prefix 'u'
  return 'u' + hash.toString('base64url');
}

/**
 * Encode public key for updateRules.key
 * Uses base64url multibase encoding
 */
function encodePublicKey(publicKeyJwk: any): string {
  const keyBytes = JSON.stringify(publicKeyJwk);
  // base64url multibase prefix 'u'
  return 'u' + Buffer.from(keyBytes).toString('base64url');
}

/**
 * Generate a JWS proof placeholder
 * In production, this would be an actual Ed25519/ECDSA signature in JWS compact form
 */
function generateProof(document: any, keyId: string, algorithm: string = 'ES256K'): string {
  // JWS header
  const header = {
    alg: algorithm,
    kid: keyId,
    crit: ['b64'],
    b64: false
  };
  
  // In production: sign the document payload
  // For now, generate a placeholder that shows the structure
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const signaturePlaceholder = Buffer.from(`SIGNATURE_PLACEHOLDER_FOR_${document.selfHash}`).toString('base64url');
  
  // JWS compact serialization: header..signature (no payload for detached)
  return `${headerB64}..${signaturePlaceholder}`;
}

/**
 * Build the verification method ID with query params per spec
 */
function buildVerificationMethodId(
  webplusDid: string,
  selfHash: string,
  versionId: number,
  keyIndex: number
): string {
  return `${webplusDid}?selfHash=${selfHash}&versionId=${versionId}#${keyIndex}`;
}

/**
 * Convert Archon verification method to did:webplus format
 */
function convertVerificationMethod(
  vm: any,
  webplusDid: string,
  selfHash: string,
  versionId: number,
  keyIndex: number
): WebplusVerificationMethod {
  const vmId = buildVerificationMethodId(webplusDid, selfHash, versionId, keyIndex);
  
  // Determine key type
  let type = 'JsonWebKey2020';
  if (vm.type) {
    type = vm.type;
  }
  
  // Build publicKeyJwk with kid
  const publicKeyJwk = {
    kid: vmId,
    ...vm.publicKeyJwk
  };
  
  return {
    id: vmId,
    type,
    controller: webplusDid,
    publicKeyJwk
  };
}

/**
 * Create a did:webplus document from Archon DID data
 */
function createWebplusDocument(
  webplusDid: string,
  versionId: number,
  validFrom: string,
  selfHash: string,
  prevSelfHash: string | undefined,
  didDoc: any,
  didData: any,
  isRoot: boolean
): WebplusDocument {
  // Convert verification methods
  const verificationMethods: WebplusVerificationMethod[] = (didDoc.verificationMethod || [])
    .map((vm: any, index: number) => convertVerificationMethod(
      vm, webplusDid, selfHash, versionId, index
    ));
  
  // Get primary key for updateRules and proofs
  const primaryKey = verificationMethods[0];
  const primaryKeyJwk = primaryKey?.publicKeyJwk;
  
  // Build updateRules based on whether this is root or update
  const updateRules: { hashedKey?: string; key?: string } = {};
  if (isRoot && primaryKeyJwk) {
    // Root document uses hashedKey
    updateRules.hashedKey = hashPublicKey(primaryKeyJwk);
  } else if (primaryKeyJwk) {
    // Update document uses key (unhashed)
    updateRules.key = encodePublicKey(primaryKeyJwk);
  }
  
  // Build verification method references (just the fragment)
  const keyRefs = verificationMethods.map((_, index) => `#${index}`);
  
  const doc: WebplusDocument = {
    id: webplusDid,
    selfHash,
    updateRules,
    validFrom,
    versionId,
    verificationMethod: verificationMethods,
    authentication: keyRefs,
    assertionMethod: keyRefs,
    keyAgreement: keyRefs,
    capabilityInvocation: keyRefs,
    capabilityDelegation: keyRefs,
    alsoKnownAs: [
      `did:cid:${extractAid(didDoc.id || selfHash)}`,
      `did:web:${webplusDid.split(':')[2]}:${selfHash}`
    ]
  };

  // Add prevDIDDocumentSelfHash for non-root documents
  if (prevSelfHash) {
    doc.prevDIDDocumentSelfHash = prevSelfHash;
  }
  
  // Add proofs for non-root documents (root doesn't require proofs)
  if (!isRoot && primaryKey) {
    doc.proofs = [
      generateProof(doc, primaryKey.id, 'ES256K')
    ];
  }

  // Add credentials from manifest as service endpoints
  const manifest = didData.didDocumentData?.manifest;
  if (manifest && Object.keys(manifest).length > 0) {
    doc.service = Object.keys(manifest).map((credDid, index) => ({
      id: `#credential-${index}`,
      type: 'VerifiableCredentialService',
      serviceEndpoint: `https://archon.technology/api/v1/did/${credDid}`
    }));
  }

  return doc;
}

/**
 * Generate did:webplus files from a did:cid
 */
export async function generateWebplusFiles(
  didCid: string,
  host: string,
  path: string | null = null,
  options: {
    gatekeeperUrl?: string;
    name?: string;
  } = {}
): Promise<WebplusFiles> {
  // Allow environment variable overrides
  host = process.env.ARCHON_WEBPLUS_HOST || host;
  path = process.env.ARCHON_WEBPLUS_PATH || path;
  const gatekeeperUrl = options.gatekeeperUrl || DEFAULT_GATEKEEPER;

  // Fetch DID data
  const didData = await fetchDidData(didCid, gatekeeperUrl);
  const didDoc = didData.didDocument;
  const metadata = didData.didDocumentMetadata;

  // Extract AID (this becomes the root-self-hash)
  const aid = extractAid(didCid);

  // Construct did:webplus identifier
  const webplusDid = constructWebplusDid(host, path, aid);

  // Build microledger
  const microledger: WebplusDocument[] = [];

  // Root document (versionId = 0)
  const rootDoc = createWebplusDocument(
    webplusDid,
    0,
    metadata.created,
    aid, // Root self-hash is the AID
    undefined, // No previous for root
    didDoc,
    didData,
    true // isRoot
  );
  microledger.push(rootDoc);

  // If there are updates, add the current version
  const currentVersion = parseInt(metadata.versionSequence || '1', 10);
  if (currentVersion > 1 && metadata.versionId) {
    // Add current state as latest version
    const currentDoc = createWebplusDocument(
      webplusDid,
      currentVersion,
      metadata.updated,
      metadata.versionId, // Current version's self-hash
      aid, // Previous is the root (simplified - full history would chain all versions)
      didDoc,
      didData,
      false // isRoot
    );
    microledger.push(currentDoc);
  }

  // Generate JSON Lines format
  const microledgerJsonl = microledger
    .map(doc => JSON.stringify(doc))
    .join('\n');

  return {
    microledger,
    microledgerJsonl,
    did: webplusDid,
    latestDocument: microledger[microledger.length - 1]
  };
}

/**
 * Generate did:webplus URL paths for hosting
 */
export function getWebplusPaths(rootSelfHash: string): { microledger: string } {
  return {
    microledger: `/${rootSelfHash}/did-documents.jsonl`
  };
}

/**
 * Parse a did:webplus identifier
 */
export function parseWebplusDid(did: string): { host: string; path: string | null; rootSelfHash: string } {
  if (!did.startsWith('did:webplus:')) {
    throw new Error('Invalid did:webplus format');
  }

  const parts = did.slice(12).split(':');
  if (parts.length < 2) {
    throw new Error('Invalid did:webplus format - missing root-self-hash');
  }

  const host = decodeURIComponent(parts[0]);
  const rootSelfHash = parts[parts.length - 1];
  const path = parts.length > 2 ? parts.slice(1, -1).join(':') : null;

  return { host, path, rootSelfHash };
}
