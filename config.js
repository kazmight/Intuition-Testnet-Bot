export default {
  network: {
    l2Rpc: 'https://testnet.rpc.intuition.systems/http',
    nativeSymbol: 'tTRUST',
    explorerTx: 'https://testnet.explorer.intuition.systems/tx/',
    label: 'Intuition Testnet (13579)',
    arbSys: '0x0000000000000000000000000000000000000064'
  },

  
  watchlist: {
    erc20: [
      // '0xYourERC20Address'
    ],
    erc721: [
      // '0xYourNFTAddress'
    ]
  },

  
  withdraw: {
    enabled: false,
    destination: '0x000000000000000000000000000000000000dEaD',
    amountEth: 0.0001
  },

  
  randomNative: {
    enabled: false,
    txCount: 3,
    minEth: 0.00001,
    maxEth: 0.00005,
    delaySec: 2
  },

  
  erc20: {
    enabled: true,
    name: 'RANDOM',      
    symbol: 'RANDOM',    
    decimals: 18,
    supply: 1_000_000,
    autoSend: {
      enabled: true,
      txCount: 5,
      amountPerTx: 250,
      delaySec: 3
    }
  },

  
  nft: {
    enabled: true,
    name: 'RANDOM',
    symbol: 'RND',
    supply: 333,
    mintChunk: 100,
    autoSend: {
      enabled: true,
      txCount: 5,
      delaySec: 4
    }
  }
};

export const Random = {
  symbol(len = 3) {
    const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    return Array.from({ length: len }, () => ABC[Math.floor(Math.random()*ABC.length)]).join('');
  },
  tokenName(prefix = 'Token') {
    return `${prefix}-${this.symbol(3)}${Math.floor(100 + Math.random()*900)}`;
  },
  nftName(prefix = 'NFT') {
    return `${prefix}-${this.symbol(3)}${Math.floor(100 + Math.random()*900)}`;
  },
  float(min, max, digits = 8) {
    const v = Math.random() * (max - min) + min;
    return Number(v.toFixed(digits));
  }
};