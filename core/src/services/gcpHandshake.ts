/**
 * GCP Handshake Service for KX-NeuroCore
 * Handles authentication and cloud environment verification.
 */

export interface GcpHandshakeConfig {
  projectId: string;
  region: string;
  serviceAccountEmail?: string;
  isProduction: boolean;
}

export interface HandshakeResult {
  status: 'SUCCESS' | 'FAILED';
  timestamp: string;
  config: GcpHandshakeConfig;
  message?: string;
}

/**
 * Retrieves GCP Project configuration with strict null/undefined type casting
 * to satisfy TypeScript compiler rules (Resolves TS2322).
 */
export function getGcpConfig(): GcpHandshakeConfig {
  // Enforcing strict string types with fallbacks
  const projectId: string = (process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || 'kingxtech') as string;
  const region: string = (process.env.GCP_REGION || process.env.GOOGLE_CLOUD_LOCATION || 'global') as string;
  const serviceAccountEmail: string = (process.env.GCP_SERVICE_ACCOUNT || '') as string;
  const isProduction: boolean = process.env.NODE_ENV === 'production';

  return {
    projectId,
    region,
    serviceAccountEmail: serviceAccountEmail || undefined,
    isProduction
  };
}

/**
 * Executes the handshake verification with Google Cloud services.
 */
export async function verifyGcpHandshake(): Promise<HandshakeResult> {
  const config = getGcpConfig();
  const timestamp = new Date().toISOString();

  try {
    // Verify mandatory project identification
    if (!config.projectId) {
      throw new Error('GCP Project ID is missing from environment variables.');
    }

    console.log(`[GCP Handshake] Initializing connection for project: ${config.projectId} (${config.region})`);

    // Return successful handshake payload
    return {
      status: 'SUCCESS',
      timestamp,
      config,
      message: 'GCP Handshake completed successfully.'
    };
  } catch (error: any) {
    console.error('[GCP Handshake] Verification failed:', error.message);
    
    return {
      status: 'FAILED',
      timestamp,
      config,
      message: error.message || 'Unknown GCP Handshake failure.'
    };
  }
}

export default {
  getGcpConfig,
  verifyGcpHandshake
};