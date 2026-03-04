/**
 * did:webplus VDR HTTP Server
 * Serves did-documents.jsonl microledger files for Archon DIDs
 */

import express, { Express, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { generateWebplusFiles, extractAid, parseWebplusDid } from './generator.js';

export interface ServerOptions {
  gatekeeperUrl?: string;
  staticDir?: string;
  cacheSeconds?: number;
}

// In-memory cache
const cache = new Map<string, { microledgerJsonl: string; latestDocument: any; timestamp: number }>();

export function createServer(options: ServerOptions = {}): Express {
  const {
    gatekeeperUrl = 'https://archon.technology',
    staticDir,
    cacheSeconds = 300
  } = options;

  const cacheTtl = cacheSeconds * 1000;
  const app = express();

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'did-webplus-archon',
      version: '0.1.0',
      role: 'VDR'
    });
  });

  // Serve did-documents.jsonl (microledger)
  app.get('/:rootSelfHash/did-documents.jsonl', async (req: Request, res: Response) => {
    const rootSelfHash = req.params.rootSelfHash;

    // Try static file first
    if (staticDir) {
      const staticPath = path.join(staticDir, rootSelfHash, 'did-documents.jsonl');
      if (fs.existsSync(staticPath)) {
        res.setHeader('Content-Type', 'application/jsonl');
        res.setHeader('X-Source', 'static');
        return res.sendFile(path.resolve(staticPath));
      }
    }

    // Check cache
    const cached = cache.get(rootSelfHash);
    if (cached && Date.now() - cached.timestamp < cacheTtl) {
      res.setHeader('Content-Type', 'application/jsonl');
      res.setHeader('X-Cache', 'HIT');
      return res.send(cached.microledgerJsonl);
    }

    // Generate dynamically
    try {
      const didCid = `did:cid:${rootSelfHash}`;
      const host = req.get('host') || 'localhost';

      const files = await generateWebplusFiles(didCid, host, null, {
        gatekeeperUrl
      });

      cache.set(rootSelfHash, {
        microledgerJsonl: files.microledgerJsonl,
        latestDocument: files.latestDocument,
        timestamp: Date.now()
      });

      res.setHeader('Content-Type', 'application/jsonl');
      res.setHeader('X-Cache', 'MISS');
      res.send(files.microledgerJsonl);

    } catch (error) {
      console.error('Error generating microledger:', error);
      res.status(404).json({
        error: 'DID not found',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Serve latest DID document (convenience endpoint)
  app.get('/:rootSelfHash/did.json', async (req: Request, res: Response) => {
    const rootSelfHash = req.params.rootSelfHash;

    // Check cache
    const cached = cache.get(rootSelfHash);
    if (cached && Date.now() - cached.timestamp < cacheTtl) {
      res.setHeader('Content-Type', 'application/did+json');
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.latestDocument);
    }

    // Generate dynamically
    try {
      const didCid = `did:cid:${rootSelfHash}`;
      const host = req.get('host') || 'localhost';

      const files = await generateWebplusFiles(didCid, host, null, {
        gatekeeperUrl
      });

      cache.set(rootSelfHash, {
        microledgerJsonl: files.microledgerJsonl,
        latestDocument: files.latestDocument,
        timestamp: Date.now()
      });

      res.setHeader('Content-Type', 'application/did+json');
      res.setHeader('X-Cache', 'MISS');
      res.json(files.latestDocument);

    } catch (error) {
      console.error('Error generating did.json:', error);
      res.status(404).json({
        error: 'DID not found',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Resolution endpoint (Universal Resolver compatible)
  app.get('/resolve/:did(*)', async (req: Request, res: Response) => {
    try {
      const did = req.params.did;

      if (!did.startsWith('did:webplus:')) {
        return res.status(400).json({ error: 'Invalid did:webplus format' });
      }

      const { host, path: didPath, rootSelfHash } = parseWebplusDid(did);
      const didCid = `did:cid:${rootSelfHash}`;

      const files = await generateWebplusFiles(didCid, host, didPath, {
        gatekeeperUrl
      });

      res.json({
        didDocument: files.latestDocument,
        didResolutionMetadata: {
          contentType: 'application/did+json',
          retrieved: new Date().toISOString()
        },
        didDocumentMetadata: {
          versionId: files.latestDocument.versionId,
          nextUpdate: undefined,
          equivalentId: [`did:cid:${rootSelfHash}`],
          canonicalId: `did:cid:${rootSelfHash}`
        }
      });

    } catch (error) {
      res.status(404).json({
        didDocument: null,
        didResolutionMetadata: {
          error: 'notFound',
          message: error instanceof Error ? error.message : 'Unknown error'
        }
      });
    }
  });

  // Version-specific resolution (did:webplus feature)
  app.get('/:rootSelfHash/versions/:versionId', async (req: Request, res: Response) => {
    const rootSelfHash = req.params.rootSelfHash;
    const versionId = parseInt(req.params.versionId, 10);

    try {
      const didCid = `did:cid:${rootSelfHash}`;
      const host = req.get('host') || 'localhost';

      const files = await generateWebplusFiles(didCid, host, null, {
        gatekeeperUrl
      });

      const versionDoc = files.microledger.find(doc => doc.versionId === versionId);
      if (!versionDoc) {
        return res.status(404).json({ error: `Version ${versionId} not found` });
      }

      res.setHeader('Content-Type', 'application/did+json');
      res.json(versionDoc);

    } catch (error) {
      res.status(404).json({
        error: 'DID not found',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  return app;
}

// Run as standalone server if executed directly
const isMain = process.argv[1]?.endsWith('server.js');
if (isMain) {
  const port = parseInt(process.env.PORT || '7677', 10);
  const app = createServer();
  app.listen(port, () => {
    console.log(`did-webplus-archon VDR running at http://0.0.0.0:${port}`);
  });
}
