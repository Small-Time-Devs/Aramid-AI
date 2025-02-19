import { 
  Connection, 
  PublicKey,
  Transaction,
  Keypair,
  sendAndConfirmTransaction 
} from '@solana/web3.js';
import bs58 from 'bs58';  // Add this import
import { 
  createCloseAccountInstruction, 
  createBurnInstruction,
  getAccount,
  TOKEN_PROGRAM_ID 
} from '@solana/spl-token';
import { config } from '../config/config.mjs';

function createKeypairFromPrivateKey(privateKeyString) {
  try {
    // Handle base58 encoded private key
    if (!privateKeyString.includes(',')) {
      try {
        // Decode base58 string using bs58
        const decoded = bs58.decode(privateKeyString);
        return Keypair.fromSecretKey(decoded);
      } catch (error) {
        console.error('Error decoding base58 private key:', error);
        throw error;
      }
    }
    
    // Handle comma-separated number array
    const privateKeyUint8 = new Uint8Array(
      privateKeyString.split(',').map(num => parseInt(num.trim()))
    );

    // Validate key length
    if (privateKeyUint8.length !== 64) {
      throw new Error(`Invalid private key length: ${privateKeyUint8.length}`);
    }

    return Keypair.fromSecretKey(privateKeyUint8);
  } catch (error) {
    console.error('Error creating keypair:', error);
    throw error;
  }
}

export async function checkTokenBalance(tokenMint) {
  try {
    const connection = new Connection(config.cryptoGlobals.rpcNode);
    
    // Get wallet details
    const walletDetails = await getWalletDetails();
    if (!walletDetails?.solPublicKey) {
      throw new Error('Wallet public key not found');
    }

    const mint = new PublicKey(tokenMint);
    const owner = new PublicKey(walletDetails.solPublicKey);

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

export async function checkSolanaBalance(walletAddress) {
  try {
    const connection = new Connection(config.cryptoGlobals.rpcNode);
    const publicKey = new PublicKey(walletAddress);
    const balance = await connection.getBalance(publicKey);
    return balance / 1e9; // Convert lamports to SOL
  } catch (error) {
    console.error('Error checking SOL balance:', error);
    throw error;
  }
}

export async function closeTokenAccount(tokenMint, owner, privateKeyString) {
  try {
    // Log the private key format check
    console.log('Private key format check:', {
      length: privateKeyString.length,
      isCommaDelimited: privateKeyString.includes(','),
      firstFewChars: privateKeyString.substring(0, 10) + '...'
    });

    // Enhanced connection with shorter timeout and finalized commitment
    const connection = new Connection(config.cryptoGlobals.rpcNode, {
      commitment: 'finalized',
      confirmTransactionInitialTimeout: 60000, // 1 minute timeout
      wsEndpoint: config.cryptoGlobals.rpcNode.replace('http', 'ws')
    });

    const mint = new PublicKey(tokenMint);
    const ownerPubkey = new PublicKey(owner);
    
    let ownerKeypair;
    try {
      ownerKeypair = createKeypairFromPrivateKey(privateKeyString);
    } catch (error) {
      console.error('Failed to create keypair:', error);
      return false;
    }

    // Verify keypair matches owner
    if (ownerKeypair.publicKey.toBase58() !== owner) {
      console.error('Keypair public key does not match owner');
      return false;
    }

    // Find token account
    const tokenAccounts = await connection.getTokenAccountsByOwner(ownerPubkey, {
      mint: mint,
      programId: TOKEN_PROGRAM_ID,
    });

    if (tokenAccounts.value.length === 0) {
      console.log('No token account found to close');
      return true; // Return true since there's nothing to close
    }

    const tokenAccount = tokenAccounts.value[0].pubkey;
    const balance = await checkTokenBalance(tokenMint, owner);

    // If there are remaining tokens, burn them first
    if (balance > 0) {
      console.log(`Burning remaining ${balance} tokens before closing account`);
      const burnIx = createBurnInstruction(
        tokenAccount,
        mint,
        ownerPubkey,
        balance
      );
      
      const burnTx = new Transaction().add(burnIx);
      
      // Get latest blockhash and send burn transaction
      const latestBlockhash = await connection.getLatestBlockhash('finalized');
      burnTx.recentBlockhash = latestBlockhash.blockhash;
      burnTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      burnTx.feePayer = ownerKeypair.publicKey;
      
      await sendAndConfirmTransaction(connection, burnTx, [ownerKeypair], {
        skipPreflight: false,
        preflightCommitment: 'finalized',
        commitment: 'finalized'
      });
    }

    // Create close account transaction
    const closeIx = createCloseAccountInstruction(
      tokenAccount,
      ownerPubkey,
      ownerPubkey
    );

    const closeTx = new Transaction().add(closeIx);

    // Implement shorter retry logic
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const latestBlockhash = await connection.getLatestBlockhash('finalized');
        closeTx.recentBlockhash = latestBlockhash.blockhash;
        closeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
        closeTx.feePayer = ownerKeypair.publicKey;

        const signature = await sendAndConfirmTransaction(
          connection, 
          closeTx, 
          [ownerKeypair],
          {
            skipPreflight: false,
            preflightCommitment: 'finalized',
            commitment: 'finalized'
          }
        );

        console.log('Token account closed successfully with signature:', signature);
        return true;
      } catch (err) {
        lastError = err;
        console.log(`Attempt ${attempt}/${maxRetries} failed:`, err.message);
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
      }
    }

    throw new Error(`Failed to close token account after ${maxRetries} attempts. Last error: ${lastError?.message}`);
  } catch (error) {
    console.error('Error closing token account:', error);
    return false;
  }
}
