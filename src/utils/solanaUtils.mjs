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
    // Log the private key length and format for debugging
    console.log('Private key format check:', {
      length: privateKeyString.length,
      isCommaDelimited: privateKeyString.includes(','),
      firstFewChars: privateKeyString.substring(0, 10) + '...'
    });

    const connection = new Connection(config.cryptoGlobals.rpcNode);
    const mint = new PublicKey(tokenMint);
    const ownerPubkey = new PublicKey(owner);
    
    // Create keypair with enhanced error handling
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
      return false;
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
      await sendAndConfirmTransaction(connection, burnTx, [ownerKeypair]);
    }

    // Create and send close account transaction
    const closeIx = createCloseAccountInstruction(
      tokenAccount,
      ownerPubkey, // Destination for rent SOL
      ownerPubkey, // Authority
    );

    const closeTx = new Transaction().add(closeIx);
    await sendAndConfirmTransaction(connection, closeTx, [ownerKeypair]);
    
    console.log('Token account closed successfully');
    return true;
  } catch (error) {
    console.error('Error closing token account:', error);
    return false;
  }
}
