/**
 * did:webplus Generator for Archon Protocol
 * Generates did-documents.jsonl microledger from did:cid identifiers
 */

export interface WebplusDocument {
  '@context': string[];
  id: string;
  versionId: number;
  validFrom: string;
  selfHash: string;
  selfSignature: string;
  selfSignatureVerifier: string;
  prevDIDDocumentSelfHash?: string;
  verificationMethod: any[];
  authentication: string[];
  assertionMethod: string[];
  capabilityInvocation: string[];
  capabilityDelegation?: string[];
  service?: any[];
  alsoKnownAs?: string[];
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
 * Generate a self-signature placeholder
 * In production, this would be an actual ECDSA signature
 */
function generateSelfSignature(document: any, keyId: string): string {
  // Placeholder - in production this would be actual signature
  return `ECDSA_SECP256K1_SIGNATURE_BY_${keyId}`;
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
  didData: any
): WebplusDocument {
  // Get the key ID for self-signature verification
  const keyId = didDoc.verificationMethod?.[0]?.id || '#key-1';
  
  const doc: WebplusDocument = {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/jws-2020/v1'
    ],
    id: webplusDid,
    versionId,
    validFrom,
    selfHash,
    selfSignature: generateSelfSignature({ selfHash, versionId }, keyId),
    selfSignatureVerifier: keyId,
    verificationMethod: didDoc.verificationMethod?.map((vm: any) => ({
      ...vm,
      controller: webplusDid
    })) || [],
    authentication: didDoc.authentication || [keyId],
    assertionMethod: didDoc.assertionMethod || [keyId],
    capabilityInvocation: [keyId], // Required for did:webplus - defines who can update
    alsoKnownAs: [
      `did:cid:${selfHash}`,
      `did:web:${webplusDid.split(':')[2]}:${selfHash}`
    ]
  };

  // Add prevDIDDocumentSelfHash for non-root documents
  if (prevSelfHash) {
    doc.prevDIDDocumentSelfHash = prevSelfHash;
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
    didData
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
      didData
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
