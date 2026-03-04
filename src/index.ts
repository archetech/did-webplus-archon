/**
 * did-webplus-archon
 * 
 * did:webplus VDR driver using Archon Protocol as backend infrastructure
 * 
 * @example
 * ```typescript
 * import { generateWebplusFiles, createServer } from '@archon-protocol/did-webplus';
 * 
 * // Generate microledger
 * const files = await generateWebplusFiles(
 *   'did:cid:bagaaiera...',
 *   'archon.social'
 * );
 * 
 * // Or run a VDR server
 * const app = createServer();
 * app.listen(7677);
 * ```
 */

export {
  generateWebplusFiles,
  extractAid,
  constructWebplusDid,
  getWebplusPaths,
  getResolutionUrl,
  parseWebplusDid,
  type WebplusDocument,
  type WebplusFiles
} from './generator.js';

export {
  createServer,
  type ServerOptions
} from './server.js';
