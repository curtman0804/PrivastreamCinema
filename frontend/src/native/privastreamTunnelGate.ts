import { NativeModules, Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '../utils/mmkvStorage';

const EXPECTED_PACKAGE = 'com.privastream.cinema';

type TunnelStatus = {
  authorized?: boolean;
  state?: string;
  packageName?: string;
  appOnly?: boolean;
};

type ProvisioningIdentity = {
  deviceId?: string;
  publicKey?: string;
  privateKeyProtected?: boolean;
};

type ProvisionResponse = {
  device_id?: string;
  address?: string;
  dns?: string;
  server_public_key?: string;
  endpoint?: string;
  allowed_ips?: string;
  persistent_keepalive?: number;
  app_only_package?: string;
};

function requireString(value: unknown, field: string): string {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new Error(`Tunnel provisioning missing ${field}`);
  }
  return text;
}

function validateNativeStatus(status: TunnelStatus): void {
  if (status.packageName !== EXPECTED_PACKAGE) {
    throw new Error('Tunnel native package validation failed');
  }

  if (status.appOnly !== true) {
    throw new Error('Tunnel is not configured as app-only');
  }
}

export async function ensurePrivastreamTunnel(authToken?: string): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }

  const tunnel: any = NativeModules?.PrivastreamTunnel;

  if (
    !tunnel ||
    typeof tunnel.status !== 'function' ||
    typeof tunnel.prepare !== 'function' ||
    typeof tunnel.provisioningIdentity !== 'function' ||
    typeof tunnel.connectProvisioned !== 'function'
  ) {
    throw new Error('Privastream native tunnel module is unavailable');
  }

  let status: TunnelStatus = await tunnel.status();

  validateNativeStatus(status);

  if (status.authorized === true && status.state === 'up') {
    console.log('[V740_TUNNEL] already UP');
    return;
  }

  if (status.authorized !== true) {
    console.log('[V740_TUNNEL] requesting Android VPN authorization');

    const granted = await tunnel.prepare();

    if (granted !== true) {
      throw new Error('Android VPN authorization was declined');
    }

    status = await tunnel.status();
    validateNativeStatus(status);

    if (status.authorized !== true) {
      throw new Error('Android VPN authorization was not granted');
    }
  }

  if (status.state === 'up') {
    console.log('[V740_TUNNEL] UP after authorization');
    return;
  }

  if (status.state !== 'down') {
    throw new Error(
      `Privastream tunnel is not in a provisionable state: ${String(status.state)}`
    );
  }

  const identity: ProvisioningIdentity =
    await tunnel.provisioningIdentity();

  const deviceId = requireString(identity.deviceId, 'deviceId');
  const publicKey = requireString(identity.publicKey, 'publicKey');

  if (identity.privateKeyProtected !== true) {
    throw new Error('Privastream tunnel private key protection is unavailable');
  }

  const token =
    typeof authToken === 'string' && authToken.trim()
      ? authToken.trim()
      : await AsyncStorage.getItem('auth_token');

  if (!token) {
    throw new Error('Authenticated Privastream session is required');
  }

  const backend = String(
    process.env.EXPO_PUBLIC_BACKEND_URL ||
      Constants.expoConfig?.extra?.backendUrl ||
      ''
  )
    .trim()
    .replace(/\/+$/, '');

  if (!backend) {
    throw new Error('Privastream production backend URL is unavailable');
  }

  if (!/^https:\/\//i.test(backend)) {
    throw new Error('Privastream tunnel provisioning requires HTTPS backend');
  }

  console.log('[V740_TUNNEL] requesting authenticated provisioning');

  const response = await fetch(`${backend}/api/tunnel/provision`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      device_id: deviceId,
      public_key: publicKey,
      platform: 'android',
      app_version:
        Constants.expoConfig?.version ||
        Constants.nativeAppVersion ||
        null,
    }),
  });

  if (!response.ok) {
    let detail = '';

    try {
      detail = (await response.text()).slice(0, 240);
    } catch (_) {}

    throw new Error(
      `Tunnel provisioning failed: HTTP ${response.status}` +
        (detail ? ` ${detail}` : '')
    );
  }

  const provision: ProvisionResponse = await response.json();

  const address = requireString(provision.address, 'address');
  const dns = requireString(provision.dns, 'dns');
  const serverPublicKey = requireString(
    provision.server_public_key,
    'server_public_key'
  );
  const endpoint = requireString(provision.endpoint, 'endpoint');
  const allowedIps = requireString(
    provision.allowed_ips,
    'allowed_ips'
  );
  const appOnlyPackage = requireString(
    provision.app_only_package,
    'app_only_package'
  );

  const persistentKeepalive =
    Number(provision.persistent_keepalive);

  if (
    !Number.isInteger(persistentKeepalive) ||
    persistentKeepalive < 0 ||
    persistentKeepalive > 65535
  ) {
    throw new Error('Tunnel persistent_keepalive is invalid');
  }

  if (appOnlyPackage !== EXPECTED_PACKAGE) {
    throw new Error('Tunnel provisioning returned the wrong application');
  }

  console.log('[V740_TUNNEL] starting provisioned WireGuard tunnel');

  const state = await tunnel.connectProvisioned(
    address,
    dns,
    serverPublicKey,
    endpoint,
    allowedIps,
    persistentKeepalive,
    appOnlyPackage
  );

  if (String(state).toLowerCase() !== 'up') {
    throw new Error(
      `Privastream tunnel failed to enter UP state: ${String(state)}`
    );
  }

  const finalStatus: TunnelStatus = await tunnel.status();

  validateNativeStatus(finalStatus);

  if (
    finalStatus.authorized !== true ||
    finalStatus.state !== 'up'
  ) {
    throw new Error('Privastream tunnel failed final native verification');
  }

  console.log('[V740_TUNNEL] READY');
}