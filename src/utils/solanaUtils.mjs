import { Connection, PublicKey } from '@solana/web3.js';
import { getAccount, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { config } from '../config/config.mjs';

export async function checkTokenBalance(tokenMint, ownerPublicKey) {
  try {
    const connection = new Connection(config.cryptoGlobals.rpcNode);
    const mint = new PublicKey(tokenMint);
    const owner = new PublicKey(ownerPublicKey);

    // Find token account
    const tokenAccounts = await connection.getTokenAccountsByOwner(owner, {
      mint: mint,
      programId: TOKEN_PROGRAM_ID,
    });

    if (tokenAccounts.value.length === 0) {
      console.log('No token account found for this mint');
      return 0;
    }

    // Get token balance from the first account
    const account = await getAccount(connection, tokenAccounts.value[0].pubkey);
    return Number(account.amount);
  } catch (error) {
    console.error('Error checking token balance:', error);
    return 0;
  }
}
