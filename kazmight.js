import 'dotenv/config';
import { ethers } from 'ethers';
import solc from 'solc';
import fs from 'fs';
import path from 'path';

import config, { Random } from './config.js';
import CryptoBotUI from './crypto-bot-ui.js';


const LAST_ERC20 = path.join(process.cwd(), 'last_deployed_erc20.json');
const LAST_NFT  = path.join(process.cwd(), 'last_deployed_nft.json');
const WL_FILE   = path.join(process.cwd(), 'watchlist.json');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const explorer = (tx) => `${config.network.explorerTx}${tx}`;
const randomAddress = () => ethers.Wallet.createRandom().address;
const fmtUnits = (bn, dec=18) => ethers.utils.formatUnits(bn, dec);

function ensurePK() {
  if (!process.env.PRIVATE_KEY) throw new Error('PRIVATE_KEY belum ada di .env');
}
function provider() {
  return new ethers.providers.JsonRpcProvider(config.network.l2Rpc);
}
function signer(p) {
  return new ethers.Wallet(process.env.PRIVATE_KEY, p);
}
function save(file, data) { try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch {} }
function read(file) { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : null; } catch { return null; } }
function uniqLower(arr) {
  const s = new Set(); const out = [];
  for (const a of arr || []) { if (!a) continue; const k = a.toLowerCase(); if (!s.has(k)) { s.add(k); out.push(a); } }
  return out;
}


const stats = {
  total: 0,
  success: 0,
  failed: 0,
  pending: 0,
  gasGwei: 0
};
function pushStats(ui) {
  const denom = (stats.success + stats.failed) || 1;
  ui.updateStats({
    transactionCount: stats.total,
    successRate: (stats.success / denom) * 100,
    failedTx: stats.failed,
    pendingTx: stats.pending,
    currentGasPrice: Number(stats.gasGwei || 0).toFixed(2)
  });
}
function onPending(ui) {
  stats.pending += 1;
  pushStats(ui);
}
function onSuccess(ui, receipt) {
  stats.total += 1;
  stats.success += 1;
  stats.pending = Math.max(0, stats.pending - 1);
  if (receipt?.effectiveGasPrice) {
    try { stats.gasGwei = Number(ethers.utils.formatUnits(receipt.effectiveGasPrice, 'gwei')); } catch {}
  }
  pushStats(ui);
}
function onFailed(ui) {
  stats.total += 1;
  stats.failed += 1;
  stats.pending = Math.max(0, stats.pending - 1);
  pushStats(ui);
}


const ARBSYS_ABI = ['function withdrawEth(address destination) payable returns (uint256)'];


const ERC20_SRC = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract SimpleERC20 {
    string public name; string public symbol; uint8 public decimals; uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from,address indexed to,uint256 value);
    event Approval(address indexed owner,address indexed spender,uint256 value);

    constructor(string memory _n,string memory _s,uint8 _d,uint256 _supply){
        name=_n;symbol=_s;decimals=_d;totalSupply=_supply;balanceOf[msg.sender]=_supply;
        emit Transfer(address(0),msg.sender,_supply);
    }
    function transfer(address to,uint256 val) public returns(bool){
        require(to!=address(0),"zero");
        uint256 b=balanceOf[msg.sender]; require(b>=val,"bal");
        unchecked { balanceOf[msg.sender]=b-val; balanceOf[to]+=val; }
        emit Transfer(msg.sender,to,val); return true;
    }
    function approve(address spender,uint256 val) public returns(bool){
        allowance[msg.sender][spender]=val; emit Approval(msg.sender,spender,val); return true;
    }
    function transferFrom(address from,address to,uint256 val) public returns(bool){
        require(to!=address(0),"zero");
        uint256 b=balanceOf[from]; require(b>=val,"bal");
        uint256 a=allowance[from][msg.sender]; require(a>=val,"allow");
        unchecked { balanceOf[from]=b-val; allowance[from][msg.sender]=a-val; balanceOf[to]+=val; }
        emit Transfer(from,to,val); return true;
    }
}
`;

const ERC721_SRC = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract SimpleERC721Batch {
    string public name; string public symbol; address public owner; uint256 public maxSupply; uint256 public currentIndex;
    mapping(uint256 => address) private _owners; mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals; mapping(address => mapping(address => bool)) private _operatorApprovals;
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    constructor(string memory _n, string memory _s, uint256 _max) { require(_max>0,"max=0"); name=_n; symbol=_s; owner=msg.sender; maxSupply=_max; currentIndex=0; }
    function totalSupply() public view returns (uint256) { return currentIndex; }
    function balanceOf(address _o) public view returns (uint256) { require(_o!=address(0),"zero"); return _balances[_o]; }
    function ownerOf(uint256 tokenId) public view returns (address) { address o=_owners[tokenId]; require(o!=address(0),"nonexistent"); return o; }
    function approve(address to,uint256 tokenId) public { address o = ownerOf(tokenId); require(to!=o,"self"); require(msg.sender==o || isApprovedForAll(o,msg.sender),"not allowed"); _tokenApprovals[tokenId]=to; emit Approval(o,to,tokenId); }
    function getApproved(uint256 tokenId) public view returns (address) { require(_owners[tokenId]!=address(0),"nonexistent"); return _tokenApprovals[tokenId]; }
    function setApprovalForAll(address operator, bool approved) public { require(operator!=msg.sender,"self"); _operatorApprovals[msg.sender][operator]=approved; emit ApprovalForAll(msg.sender, operator, approved); }
    function isApprovedForAll(address _o, address op) public view returns (bool) { return _operatorApprovals[_o][op]; }
    function transferFrom(address from,address to,uint256 tokenId) public { require(_isApprovedOrOwner(msg.sender, tokenId),"not allowed"); _transfer(from,to,tokenId); }
    function safeTransferFrom(address from,address to,uint256 tokenId) public { transferFrom(from,to,tokenId); }
    function safeTransferFrom(address from,address to,uint256 tokenId, bytes calldata) public { transferFrom(from,to,tokenId); }
    function ownerMintBatch(uint256 count) external onlyOwner { require(count>0,"count=0"); require(currentIndex + count <= maxSupply, "exceeds"); uint256 start = currentIndex + 1; uint256 end = currentIndex + count; for (uint256 id=start; id<=end; id++){ _mint(msg.sender, id); } currentIndex = end; }
    function _mint(address to,uint256 tokenId) internal { require(to!=address(0),"zero"); require(_owners[tokenId]==address(0),"exists"); _owners[tokenId]=to; _balances[to]+=1; emit Transfer(address(0), to, tokenId); }
    function _transfer(address from,address to,uint256 tokenId) internal { require(ownerOf(tokenId)==from,"owner"); require(to!=address(0),"zero"); delete _tokenApprovals[tokenId]; _balances[from]-=1; _balances[to]+=1; _owners[tokenId]=to; emit Transfer(from,to,tokenId); }
    function _isApprovedOrOwner(address spender,uint256 tokenId) internal view returns (bool) { address o = ownerOf(tokenId); return (spender==o || getApproved(tokenId)==spender || isApprovedForAll(o,spender)); }
}
`;


function compileSol(sources) {
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } }
    }
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter(e => e.severity === 'error');
  if (errs.length) throw new Error(errs.map(e => e.formattedMessage).join('\n'));
  return out;
}


async function sendRawTracked(ui, w, tx, fallbackGasLimit, label='TX') {
  try {
    if (!tx.gasLimit) {
      try {
        const est = await w.estimateGas(tx);
        tx.gasLimit = est.mul(120).div(100);
      } catch {
        if (fallbackGasLimit) tx.gasLimit = ethers.BigNumber.from(fallbackGasLimit);
      }
    }
    onPending(ui);
    const resp = await w.sendTransaction(tx);
    ui.log?.('pending', `${label}: ${resp.hash}`);
    const rec = await resp.wait();
    onSuccess(ui, rec);
    ui.log?.('success', `${label} OK ? ${rec.transactionHash}`);
    return rec;
  } catch (e) {
    onFailed(ui);
    ui.log?.('error', `${label} FAIL: ${e.message || e}`);
    throw e;
  }
}
async function sendContractTracked(ui, txPromise, label='TX') {
  try {
    onPending(ui);
    const tx = await txPromise;
    ui.log?.('pending', `${label}: ${tx.hash}`);
    const rec = await tx.wait();
    onSuccess(ui, rec);
    ui.log?.('success', `${label} OK ? ${rec.transactionHash}`);
    return rec;
  } catch (e) {
    onFailed(ui);
    ui.log?.('error', `${label} FAIL: ${e.message || e}`);
    throw e;
  }
}


function loadWatchlist() {
  const disk = read(WL_FILE) || { erc20: [], erc721: [] };
  const base = config.watchlist || { erc20: [], erc721: [] };
  const last20 = read(LAST_ERC20);
  const last721 = read(LAST_NFT);

  const erc20 = uniqLower([
    ...(base.erc20 || []),
    ...(disk.erc20 || []),
    ...(last20?.address ? [last20.address] : [])
  ]);
  const erc721 = uniqLower([
    ...(base.erc721 || []),
    ...(disk.erc721 || []),
    ...(last721?.address ? [last721.address] : [])
  ]);

  return { erc20, erc721 };
}
function saveWatchlist(wl) { save(WL_FILE, { erc20: uniqLower(wl.erc20 || []), erc721: uniqLower(wl.erc721 || []) }); }
function addToWatchlist(type, address) {
  const wl = loadWatchlist();
  if (type === 'erc20') wl.erc20 = uniqLower([...(wl.erc20||[]), address]);
  if (type === 'erc721') wl.erc721 = uniqLower([...(wl.erc721||[]), address]);
  saveWatchlist(wl);
}

async function getERC20Meta(address, user, w) {
  const abi = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address) view returns (uint256)'
  ];
  const c = new ethers.Contract(address, abi, w);
  const [name, symbol, decimals, bal] = await Promise.all([
    c.name().catch(()=> 'ERC20'),
    c.symbol().catch(()=> 'TKN'),
    c.decimals().catch(()=> 18),
    c.balanceOf(user).catch(()=> ethers.constants.Zero)
  ]);
  return {
    type: 'erc20',
    address,
    name, symbol,
    balanceRaw: bal,
    decimals,
    balanceText: `${fmtUnits(bal, decimals)} ${symbol}`
  };
}
async function getERC721Meta(address, user, w) {
  const abi = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function balanceOf(address) view returns (uint256)'
  ];
  const c = new ethers.Contract(address, abi, w);
  const [name, symbol, bal] = await Promise.all([
    c.name().catch(()=> 'NFT'),
    c.symbol().catch(()=> 'NFT'),
    c.balanceOf(user).catch(()=> ethers.constants.Zero)
  ]);
  return {
    type: 'erc721',
    address,
    name, symbol,
    balanceRaw: bal,
    balanceText: `${bal.toString()} ${symbol}`
  };
}
async function refreshTokenPanel(ui, w, onlyPositive = true) {
  const addr = await w.getAddress();
  const wl = loadWatchlist();

  const jobs = [
    ...wl.erc20.map(a => getERC20Meta(a, addr, w)),
    ...wl.erc721.map(a => getERC721Meta(a, addr, w))
  ];

  const results = [];
  for (const job of jobs) { try { results.push(await job); } catch {} }

  let filtered = results;
  if (onlyPositive) {
    filtered = results.filter(r => (r.balanceRaw && !r.balanceRaw.isZero && !r.balanceRaw.isZero()));
    if (filtered.length === 0) filtered = results;
  }

  const items = filtered.slice(0, 10).map(meta => ({
    enabled: true,
    name: meta.name,
    symbol: meta.symbol,
    balance: meta.balanceText
  }));
  while (items.length < 10) items.push({ enabled: false, name: '-', symbol: '-', balance: '-' });

  ui.setTokens?.(items);
}


async function withdrawL2toL1(ui, w) {
  const arb = new ethers.Contract(config.network.arbSys, ARBSYS_ABI, w);
  const call = await arb.populateTransaction.withdrawEth(config.withdraw.destination);
  call.to = config.network.arbSys;
  call.value = ethers.utils.parseEther(String(config.withdraw.amountEth));
  ui.log?.('bridge', `Withdraw ${config.withdraw.amountEth} ${config.network.nativeSymbol} ? ${config.withdraw.destination}`);
  const rec = await sendRawTracked(ui, w, call, 300000, 'Withdraw');
  ui.log?.('success', `LINK: ${explorer(rec.transactionHash)}`);
}

async function randomNativeTransfers(ui, w) {
  const { txCount, minEth, maxEth, delaySec } = config.randomNative;
  for (let i = 0; i < txCount; i++) {
    const to = randomAddress();
    const amt = Random.float(minEth, maxEth, 8);
    ui.log?.('gas', `Native [${i+1}/${txCount}] ${amt} ${config.network.nativeSymbol} ? ${to}`);
    const rec = await sendRawTracked(ui, w, { to, value: ethers.utils.parseEther(amt.toFixed(8)) }, 21000, `Native #${i+1}`);
    ui.log?.('success', `LINK: ${explorer(rec.transactionHash)}`);
    if (i < txCount - 1 && delaySec > 0) { await sleep(delaySec*1000); }
  }
}

async function deployERC20(ui, w) {
  const name = (config.erc20.name === 'RANDOM') ? Random.tokenName('Token') : config.erc20.name;
  const symbol = (config.erc20.symbol === 'RANDOM') ? Random.symbol(3) : config.erc20.symbol;
  const decimals = Number(config.erc20.decimals || 18);
  const supply = ethers.utils.parseUnits(String(config.erc20.supply || 0), decimals);

  ui.log?.('info', `Deploy ERC20: ${name} (${symbol}) supply=${config.erc20.supply} dec=${decimals}`);

  const out = compileSol({ 'SimpleERC20.sol': { content: ERC20_SRC }});
  const c = out.contracts['SimpleERC20.sol']['SimpleERC20'];
  const factory = new ethers.ContractFactory(c.abi, '0x' + c.evm.bytecode.object, w);

  onPending(ui);
  const contract = await factory.deploy(name, symbol, decimals, supply, { gasLimit: 5_000_000 });
  ui.log?.('pending', `Deploy TX: ${contract.deployTransaction.hash}`);
  const rec = await contract.deployTransaction.wait();
  onSuccess(ui, rec);
  ui.log?.('success', `ERC20 deployed @ ${contract.address}`);
  ui.log?.('success', `LINK: ${explorer(rec.transactionHash)}`);

  addToWatchlist('erc20', contract.address);
  await refreshTokenPanel(ui, w, true);

  save(LAST_ERC20, { address: contract.address, name, symbol, decimals });
  return { address: contract.address, name, symbol, decimals };
}

async function autoSendERC20(ui, w, meta) {
  const cfg = config.erc20.autoSend;
  let address = meta?.address || read(LAST_ERC20)?.address;
  if (!address || !ethers.utils.isAddress(address)) throw new Error('ERC20 address tidak ditemukan');

  const token = new ethers.Contract(address, [
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address,uint256) returns (bool)'
  ], w);

  const [symbol, decimals] = await Promise.all([
    token.symbol().catch(()=> 'TKN'),
    token.decimals().catch(()=> 18)
  ]);

  for (let i=0;i<cfg.txCount;i++){
    const to = randomAddress();
    const amountRaw = ethers.utils.parseUnits(String(cfg.amountPerTx), decimals);
    ui.log?.('info', `ERC20 [${i+1}/${cfg.txCount}] ${cfg.amountPerTx} ${symbol} ? ${to}`);
    const rec = await sendContractTracked(ui, token.transfer(to, amountRaw), `ERC20 #${i+1}`);
    ui.log?.('success', `LINK: ${explorer(rec.transactionHash)}`);
    if (i < cfg.txCount-1 && cfg.delaySec>0) { await sleep(cfg.delaySec*1000); }
  }

  await refreshTokenPanel(ui, w, true);
}

async function deployNFT(ui, w) {
  const name = (config.nft.name === 'RANDOM') ? Random.nftName('NFT') : config.nft.name;
  const symbol = config.nft.symbol || 'NFT';
  const supply = Number(config.nft.supply || 0);
  const chunk = Number(config.nft.mintChunk || 100);
  if (supply <= 0) throw new Error('NFT supply harus > 0');

  ui.log?.('info', `Deploy NFT: ${name} (${symbol}) supply=${supply} chunk=${chunk}`);

  const out = compileSol({ 'SimpleERC721Batch.sol': { content: ERC721_SRC }});
  const c = out.contracts['SimpleERC721Batch.sol']['SimpleERC721Batch'];
  const factory = new ethers.ContractFactory(c.abi, '0x' + c.evm.bytecode.object, w);

  onPending(ui);
  const contract = await factory.deploy(name, symbol, ethers.BigNumber.from(supply), { gasLimit: 6_000_000 });
  ui.log?.('pending', `Deploy TX: ${contract.deployTransaction.hash}`);
  const rec = await contract.deployTransaction.wait();
  onSuccess(ui, rec);
  ui.log?.('success', `NFT deployed @ ${contract.address}`);
  ui.log?.('success', `LINK: ${explorer(rec.transactionHash)}`);

  const nft = new ethers.Contract(contract.address, c.abi, w);


  let minted = 0;
  while (minted < supply) {
    const count = Math.min(chunk, supply - minted);
    ui.log?.('pending', `Mint batch ${count} (minted=${minted}/${supply})`);
    const r = await sendContractTracked(ui, nft.ownerMintBatch(count, { gasLimit: 3_000_000 }), `Mint ${minted+1}..${minted+count}`);
    ui.log?.('success', `LINK: ${explorer(r.transactionHash)}`);
    minted += count;
  }

  addToWatchlist('erc721', contract.address);
  await refreshTokenPanel(ui, w, true);

  save(LAST_NFT, { address: contract.address, name, symbol, totalSupply: supply, nextToSend: 1 });
  return { address: contract.address, name, symbol, totalSupply: supply };
}

async function autoSendNFT(ui, w, meta) {
  const cfg = config.nft.autoSend;
  const saved = read(LAST_NFT);
  const address = (meta?.address) || (saved?.address);
  if (!address || !ethers.utils.isAddress(address)) throw new Error('NFT address tidak ditemukan');

  const nft = new ethers.Contract(address, [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function ownerOf(uint256) view returns (address)',
    'function transferFrom(address,address,uint256)'
  ], w);

  const from = await w.getAddress();
  const total = saved?.totalSupply || (await nft.totalSupply().catch(()=> ethers.constants.Zero)).toNumber();
  let cursor = saved?.nextToSend || 1;

  for (let i=0;i<cfg.txCount && cursor<=total;i++){
    let owner;
    try { owner = await nft.ownerOf(cursor); } catch { cursor++; i--; continue; }
    if (owner.toLowerCase() !== from.toLowerCase()) { cursor++; i--; continue; }

    const to = randomAddress();
    ui.log?.('info', `NFT [${i+1}/${cfg.txCount}] #${cursor} ? ${to}`);
    const rec = await sendContractTracked(ui, nft.transferFrom(from, to, cursor, { gasLimit: 300_000 }), `NFT #${cursor}`);
    ui.log?.('success', `LINK: ${explorer(rec.transactionHash)}`);
    cursor++;
    if (i < cfg.txCount-1 && cfg.delaySec>0) { await sleep(cfg.delaySec*1000); }
  }

  save(LAST_NFT, { ...(saved||{}), address, totalSupply: total, nextToSend: cursor });
  await refreshTokenPanel(ui, w, true);
}


const MENU_ITEMS = [
  '1) Bridge L2 -> L1 ',
  '2) Random Native Transfers',
  '3) Deploy ERC-20',
  '4) Auto-send ERC-20',
  '5) Deploy NFT (ERC721)',
  '6) Auto-send NFT (ERC721)',
  '7) Run All Transactions'
];

let isRunning = false;

async function handleMenuSelection(ui, idx, w, p) {
  if (isRunning) { ui.log?.('warning', 'Masih berjalan… tunggu selesai'); return; }
  isRunning = true;
  ui.setActive?.(true);

  try {
    switch (idx) {
      case 0:
        await withdrawL2toL1(ui, w);
        break;
      case 1:
        await randomNativeTransfers(ui, w);
        break;
      case 2:
        await deployERC20(ui, w);
        break;
      case 3:
        await autoSendERC20(ui, w, null);
        break;
      case 4:
        await deployNFT(ui, w);
        break;
      case 5:
        await autoSendNFT(ui, w, null);
        break;
      case 6: 
        if (config.withdraw.enabled) await withdrawL2toL1(ui, w);
        if (config.randomNative.enabled) await randomNativeTransfers(ui, w);
        let erc20Meta = null;
        if (config.erc20.enabled) erc20Meta = await deployERC20(ui, w);
        if (config.erc20.autoSend?.enabled) await autoSendERC20(ui, w, erc20Meta);
        let nftMeta = null;
        if (config.nft.enabled) nftMeta = await deployNFT(ui, w);
        if (config.nft.autoSend?.enabled) await autoSendNFT(ui, w, nftMeta);
        break;
      default:
        ui.log?.('warning', 'Pilihan tidak dikenal');
    }
  } catch (e) {
    ui.log?.('error', e.message || String(e));
  } finally {
    await refreshWallet(ui, w, p);
    await refreshTokenPanel(ui, w, true);
    isRunning = false;
    ui.setActive?.(false);
  }
}

async function refreshWallet(ui, w, p) {
  const addr = await w.getAddress();
  const [bal, fee, nonce] = await Promise.all([
    p.getBalance(addr),
    p.getFeeData(),
    p.getTransactionCount(addr, 'latest')
  ]);
  if (fee?.maxFeePerGas) {
    try { stats.gasGwei = Number(ethers.utils.formatUnits(fee.maxFeePerGas, 'gwei')); } catch {}
  }
  ui.updateWallet({
    address: addr,
    nativeBalance: `${fmtUnits(bal, 18)} ${config.network.nativeSymbol}`,
    network: config.network.label,
    gasPrice: fee.maxFeePerGas ? ethers.utils.formatUnits(fee.maxFeePerGas, 'gwei') : '0',
    nonce: String(nonce)
  });
  pushStats(ui);
}


async function main() {
  ensurePK();
  const p = provider();
  const w = signer(p);
  const ui = new CryptoBotUI({
    title: 'Intuition Testnet Dashboard',
    nativeSymbol: config.network.nativeSymbol
  });

  ui.setMenu?.(MENU_ITEMS);
  await refreshWallet(ui, w, p);
  await refreshTokenPanel(ui, w, true);
  ui.log?.('info', 'Pilih aksi di panel kiri, lalu ENTER');

  ui.on?.('menu:select', async (_label, index) => {
    await handleMenuSelection(ui, index, w, p);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
