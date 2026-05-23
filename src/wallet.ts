import { ethers } from "ethers";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as crypto from "crypto";

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
export const BASE_RPC = ALCHEMY_API_KEY
  ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
  : "https://mainnet.base.org";
export const BASE_CHAIN_ID = 8453;

const WALLET_DIR = path.join(os.homedir(), ".noelclaw");
const WALLET_FILE = path.join(WALLET_DIR, "wallet.json");
let _cachedWallet: ethers.Wallet | ethers.HDNodeWallet | null = null;

export function clearWalletCache(): void { _cachedWallet = null; }

export function getMachineKey(): string {
  // If a passphrase is set, use it as the primary secret for stronger encryption.
  // Without it, the key is derived from public machine info only — this is
  // convenience encryption (prevents casual reads), not security against
  // an attacker who has read access to both the file and system info.
  const passphrase = process.env.NOELCLAW_WALLET_PASSPHRASE ?? "";
  return crypto
    .createHash("sha256")
    .update(passphrase + os.hostname() + os.platform() + os.arch())
    .digest("hex")
    .slice(0, 32);
}

export async function getOrCreateWallet(): Promise<ethers.Wallet | ethers.HDNodeWallet> {
  if (_cachedWallet) return _cachedWallet;
  if (fs.existsSync(WALLET_FILE)) {
    try {
      const encrypted = fs.readFileSync(WALLET_FILE, "utf8");
      const wallet = await ethers.Wallet.fromEncryptedJson(encrypted, getMachineKey());
      _cachedWallet = wallet;
      return wallet;
    } catch {
      // fall through to create new wallet
    }
  }
  const wallet = ethers.Wallet.createRandom();
  if (!fs.existsSync(WALLET_DIR)) fs.mkdirSync(WALLET_DIR, { recursive: true });
  const encrypted = await wallet.encrypt(getMachineKey());
  fs.writeFileSync(WALLET_FILE, encrypted, { mode: 0o600 });
  _cachedWallet = wallet;
  return wallet;
}

export async function signRequest(toolName: string): Promise<{ address: string; signature: string; timestamp: string }> {
  const wallet = await getOrCreateWallet();
  const timestamp = Date.now().toString();
  const signature = await wallet.signMessage(`noelclaw:${toolName}:${timestamp}`);
  return { address: wallet.address, signature, timestamp };
}

async function rpcPost(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(BASE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json() as any;
  if (data.error) throw new Error(`RPC ${method} failed: ${data.error.message}`);
  return data.result;
}

async function getNonce(address: string): Promise<number> {
  return parseInt(await rpcPost("eth_getTransactionCount", [address, "latest"]), 16);
}

async function getGasPrice(): Promise<bigint> {
  return BigInt(await rpcPost("eth_gasPrice", []));
}

async function broadcastTx(signedTx: string): Promise<string> {
  return rpcPost("eth_sendRawTransaction", [signedTx]);
}

export async function signAndBroadcast(
  wallet: ethers.Wallet | ethers.HDNodeWallet,
  txData: {
    to: string;
    data: string;
    value: string;
    gas?: string;
    gasPrice?: string;
    permit2?: any;
    issues?: any;
  }
): Promise<string> {
  let data = txData.data || "0x";
  if (txData.permit2?.eip712) {
    const eip712 = txData.permit2.eip712;
    const { EIP712Domain: _d, ...typesWithout } = eip712.types ?? {};
    const sig = await wallet.signTypedData(eip712.domain, typesWithout, eip712.message);
    data = data + sig.replace("0x", "");
  }

  const [nonce, gasPrice] = await Promise.all([getNonce(wallet.address), getGasPrice()]);

  const tx = {
    to: txData.to,
    data,
    value: BigInt(txData.value || "0"),
    gasLimit: BigInt(txData.gas || "200000"),
    gasPrice: txData.gasPrice ? BigInt(txData.gasPrice) : gasPrice,
    nonce,
    chainId: BASE_CHAIN_ID,
  };

  const signedTx = await wallet.signTransaction(tx);
  return broadcastTx(signedTx);
}
