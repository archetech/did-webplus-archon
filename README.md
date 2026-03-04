# did-webplus-archon

**did:webplus VDR driver using Archon Protocol as backend infrastructure**

This package enables [did:webplus](https://ledgerdomain.github.io/did-webplus-spec/) identifiers to use [Archon Protocol](https://archon.technology) as the Verifiable Data Registry (VDR) backend.

## Overview

did:webplus extends did:web with cryptographic verifiability through a microledger of self-hashed, self-signed DID documents. This driver generates did:webplus microledgers from existing Archon (`did:cid`) identifiers.

```
did:webplus:<host>:<root-self-hash>
```

Where `root-self-hash` is the Archon CID, providing cryptographic binding to the root DID document.

## Installation

```bash
npm install @archon-protocol/did-webplus
```

Or run directly:

```bash
npx @archon-protocol/did-webplus generate <did:cid> --host example.com
```

## Quick Start

### Generate did:webplus microledger

```bash
# From a did:cid identifier
npx @archon-protocol/did-webplus generate \
  did:cid:bagaaiera7vsjlu6oiluzd4enop5j7sfzjbwp2ujudt6uunkz6hhd4lgfe4sa \
  --host archon.social \
  --output ./webplus-files

# Creates:
#   ./webplus-files/<root-hash>/did-documents.jsonl
#   ./webplus-files/<root-hash>/did.json
```

### Serve as VDR

```bash
# Start a VDR server
npx @archon-protocol/did-webplus serve --port 7677 --dir ./webplus-files

# Access at:
#   http://localhost:7677/<root-hash>/did-documents.jsonl
#   http://localhost:7677/<root-hash>/did.json
```

### Programmatic Usage

```typescript
import { generateWebplusFiles, createServer } from '@archon-protocol/did-webplus';

// Generate microledger
const files = await generateWebplusFiles(
  'did:cid:bagaaiera7vsjlu6oiluzd4enop5j7sfzjbwp2ujudt6uunkz6hhd4lgfe4sa',
  'archon.social'
);

console.log(files.did);              // did:webplus:archon.social:bagaaiera...
console.log(files.microledgerJsonl); // JSON Lines microledger
console.log(files.latestDocument);   // Current DID document

// Or create a VDR server
const app = createServer({ 
  gatekeeperUrl: 'https://archon.technology'
});
app.listen(7677);
```

## did:webplus Identifier Format

```
did:webplus:archon.social:bagaaiera7vsjlu6oiluzd4enop5j7sfzjbwp2ujudt6uunkz6hhd4lgfe4sa
            └─ host ─────┘└─ root-self-hash (Archon CID) ───────────────────────────────┘
```

The `root-self-hash` is the CID from the original `did:cid`, providing cryptographic binding.

## Microledger Format

The `did-documents.jsonl` file contains the complete DID history in JSON Lines format:

```jsonl
{"id":"did:webplus:archon.social:bagaaiera...","versionId":0,"validFrom":"2026-02-03T00:12:20Z","selfHash":"bagaaiera...","selfSignatureVerifier":"#key-1","verificationMethod":[...],"capabilityInvocation":["#key-1"]}
{"id":"did:webplus:archon.social:bagaaiera...","versionId":14,"validFrom":"2026-02-15T02:52:16Z","selfHash":"bagaaierawdhm...","prevDIDDocumentSelfHash":"bagaaiera...","verificationMethod":[...],"capabilityInvocation":["#key-1"]}
```

Each document contains:
- `versionId` — Incrementing version number (0 = root)
- `validFrom` — Timestamp when this version became active
- `selfHash` — Content hash of this document
- `selfSignature` — Signature by authorized key
- `selfSignatureVerifier` — Key ID that signed
- `prevDIDDocumentSelfHash` — Link to previous version (except root)
- `capabilityInvocation` — Keys authorized to update

## Architecture: Archon as VDR

| did:webplus Component | Archon Equivalent |
|-----------------------|-------------------|
| VDR (Verifiable Data Registry) | Gatekeeper |
| VDG (Verifiable Data Gateway) | Gatekeeper network |
| Microledger | DID version history |
| root-self-hash | CID |
| selfHash | Version CID |
| capabilityInvocation | Controller keys |

## API Reference

### `generateWebplusFiles(didCid, host, path?, options?)`

Generate did-documents.jsonl microledger from a did:cid.

```typescript
const files = await generateWebplusFiles(
  'did:cid:bagaaiera...',
  'archon.social',
  null,  // optional path
  {
    gatekeeperUrl: 'https://archon.technology'
  }
);
```

### `createServer(options?)`

Create an Express VDR server.

```typescript
const app = createServer({
  gatekeeperUrl: 'https://archon.technology',
  staticDir: './webplus-files',
  cacheSeconds: 300
});
```

### `parseWebplusDid(did)`

Parse a did:webplus identifier.

```typescript
const { host, path, rootSelfHash } = parseWebplusDid(
  'did:webplus:archon.social:bagaaiera...'
);
```

### `getResolutionUrl(did)`

Get the HTTP resolution URL for a did:webplus.

```typescript
const url = getResolutionUrl('did:webplus:archon.social:bagaaiera...');
// https://archon.social/bagaaiera.../did-documents.jsonl
```

## CLI Reference

```bash
# Generate microledger
did-webplus-archon generate <did:cid> --host <host> [--path <path>] [--output <dir>]

# Serve as VDR
did-webplus-archon serve [--port <port>] [--dir <dir>] [--gatekeeper <url>]

# Resolve a did:webplus
did-webplus-archon resolve <did:webplus>
```

## Endpoints (VDR Server)

| Endpoint | Description |
|----------|-------------|
| `GET /<rootSelfHash>/did-documents.jsonl` | Full microledger |
| `GET /<rootSelfHash>/did.json` | Latest DID document |
| `GET /<rootSelfHash>/versions/:id` | Specific version |
| `GET /resolve/:did` | Resolve did:webplus |
| `GET /health` | Health check |

## Security Model

did:webplus provides:

| Property | Implementation |
|----------|----------------|
| **Self-addressing** | Root hash embedded in DID |
| **Version chaining** | prevDIDDocumentSelfHash links |
| **Self-signing** | Each document signed by authorized key |
| **Update authorization** | capabilityInvocation defines controllers |
| **Immutable history** | Microledger is append-only |

Archon adds:

| Property | Implementation |
|----------|----------------|
| **Decentralized hosting** | Gatekeeper network |
| **Blockchain anchoring** | BTC mainnet timestamps |
| **Witness infrastructure** | Multiple gatekeepers |

## Related Projects

- [Archon Protocol](https://archon.technology) — Decentralized identity infrastructure
- [did:webplus Specification](https://ledgerdomain.github.io/did-webplus-spec/)
- [LedgerDomain did:webplus](https://github.com/LedgerDomain/did-webplus) — Reference implementation
- [did-webs-archon](https://github.com/archetech/did-webs-archon) — Sister project for did:webs

## License

Apache-2.0 — See [LICENSE](LICENSE).

---

*Built by [Archetech](https://archetech.com) — Identity infrastructure for humans and AI agents.*
