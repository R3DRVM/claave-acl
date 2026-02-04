import { BrowserProvider, Contract, JsonRpcProvider, type Signer } from 'ethers';

export function getInjectedProvider(): BrowserProvider | null {
  const anyWin = window as any;
  if (!anyWin.ethereum) return null;
  return new BrowserProvider(anyWin.ethereum);
}

export function getReadonlyProvider(): JsonRpcProvider {
  return new JsonRpcProvider('https://rpc.monad.xyz');
}

export async function ensureMonadChain(provider: BrowserProvider) {
  const net = await provider.getNetwork();
  if (Number(net.chainId) === 143) return;

  const any = provider as any;
  // EIP-1193
  await (any.provider?.request?.({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: '0x8f' }], // 143
  }));
}

export function contractRead(address: string, abi: any, provider: any) {
  return new Contract(address, abi, provider);
}

export function contractWrite(address: string, abi: any, signer: Signer) {
  return new Contract(address, abi, signer);
}
