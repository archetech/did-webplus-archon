#!/usr/bin/env node
/**
 * did-webplus-archon CLI
 * Generate and serve did:webplus files using Archon Protocol
 */

import { generateWebplusFiles, extractAid, parseWebplusDid, getResolutionUrl } from './generator.js';
import { createServer } from './server.js';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);
const command = args[0];

function printUsage() {
  console.log(`
did-webplus-archon - did:webplus VDR driver for Archon Protocol

Usage:
  did-webplus-archon generate <did:cid> --host <host> [options]
  did-webplus-archon serve [options]
  did-webplus-archon resolve <did:webplus>

Commands:
  generate    Generate did-documents.jsonl microledger
  serve       Start VDR HTTP server
  resolve     Resolve a did:webplus identifier

Generate Options:
  --host <host>       Host for did:webplus (required)
  --path <path>       Optional path component
  --output <dir>      Output directory (default: ./webplus-files)
  --gatekeeper <url>  Gatekeeper URL (default: https://archon.technology)

Serve Options:
  --port <port>       Server port (default: 7677)
  --dir <dir>         Directory with webplus files (default: ./webplus-files)
  --gatekeeper <url>  Gatekeeper URL for dynamic generation

Examples:
  did-webplus-archon generate did:cid:bagaaiera... --host archon.social
  did-webplus-archon serve --port 7677
  did-webplus-archon resolve did:webplus:archon.social:bagaaiera...
`);
}

function getArg(flag: string, defaultValue?: string): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return defaultValue;
}

async function generate() {
  const didCid = args[1];
  const host = getArg('--host');
  const pathArg = getArg('--path') || null;
  const output = getArg('--output', './webplus-files');
  const gatekeeper = getArg('--gatekeeper', 'https://archon.technology');

  if (!didCid || !host) {
    console.error('Error: did:cid and --host are required');
    printUsage();
    process.exit(1);
  }

  if (!didCid.startsWith('did:cid:')) {
    console.error('Error: Invalid did:cid format');
    process.exit(1);
  }

  console.log(`Generating did:webplus microledger...`);
  console.log(`  DID: ${didCid}`);
  console.log(`  Host: ${host}`);
  console.log(`  Gatekeeper: ${gatekeeper}`);

  try {
    const files = await generateWebplusFiles(didCid, host, pathArg, {
      gatekeeperUrl: gatekeeper
    });

    const rootSelfHash = extractAid(didCid);
    const outDir = path.join(output!, rootSelfHash);

    // Create output directory
    fs.mkdirSync(outDir, { recursive: true });

    // Write files
    const microledgerPath = path.join(outDir, 'did-documents.jsonl');
    const didJsonPath = path.join(outDir, 'did.json');

    fs.writeFileSync(microledgerPath, files.microledgerJsonl);
    fs.writeFileSync(didJsonPath, JSON.stringify(files.latestDocument, null, 2));

    console.log(`\nGenerated did:webplus: ${files.did}`);
    console.log(`Resolution URL: ${getResolutionUrl(files.did)}`);
    console.log(`\nMicroledger contains ${files.microledger.length} document(s)`);
    console.log(`\nFiles written:`);
    console.log(`  ${microledgerPath}`);
    console.log(`  ${didJsonPath}`);

  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function serve() {
  const port = parseInt(getArg('--port', '7677')!, 10);
  const dir = getArg('--dir', './webplus-files');
  const gatekeeper = getArg('--gatekeeper', 'https://archon.technology');

  console.log(`Starting did:webplus VDR server...`);
  console.log(`  Port: ${port}`);
  console.log(`  Directory: ${dir}`);
  console.log(`  Gatekeeper: ${gatekeeper}`);

  const app = createServer({
    gatekeeperUrl: gatekeeper,
    staticDir: dir
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`\ndid-webplus-archon VDR running at http://0.0.0.0:${port}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET /<rootSelfHash>/did-documents.jsonl  - Microledger`);
    console.log(`  GET /<rootSelfHash>/did.json             - Latest DID document`);
    console.log(`  GET /<rootSelfHash>/versions/:id         - Specific version`);
    console.log(`  GET /resolve/:did                        - Resolve did:webplus`);
    console.log(`  GET /health                              - Health check`);
  });
}

async function resolve() {
  const did = args[1];

  if (!did || !did.startsWith('did:webplus:')) {
    console.error('Error: Valid did:webplus identifier required');
    process.exit(1);
  }

  const gatekeeper = getArg('--gatekeeper', 'https://archon.technology');

  console.log(`Resolving: ${did}`);
  console.log(`Resolution URL: ${getResolutionUrl(did)}`);

  try {
    const { host, path: didPath, rootSelfHash } = parseWebplusDid(did);
    const didCid = `did:cid:${rootSelfHash}`;

    const files = await generateWebplusFiles(didCid, host, didPath, {
      gatekeeperUrl: gatekeeper
    });

    console.log(`\n=== Microledger (${files.microledger.length} documents) ===`);
    for (const doc of files.microledger) {
      console.log(`\n--- Version ${doc.versionId} (${doc.validFrom}) ---`);
      console.log(`selfHash: ${doc.selfHash}`);
      if (doc.prevDIDDocumentSelfHash) {
        console.log(`prevDIDDocumentSelfHash: ${doc.prevDIDDocumentSelfHash}`);
      }
    }

    console.log(`\n=== Latest DID Document ===`);
    console.log(JSON.stringify(files.latestDocument, null, 2));

    console.log(`\n=== Resolution Metadata ===`);
    console.log(JSON.stringify({
      contentType: 'application/did+json',
      versionId: files.latestDocument.versionId,
      equivalentId: [`did:cid:${rootSelfHash}`],
      canonicalId: `did:cid:${rootSelfHash}`
    }, null, 2));

  } catch (error) {
    console.error('Resolution failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Main
switch (command) {
  case 'generate':
    generate();
    break;
  case 'serve':
    serve();
    break;
  case 'resolve':
    resolve();
    break;
  case '--help':
  case '-h':
  case undefined:
    printUsage();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}
