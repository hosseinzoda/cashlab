import { hexToBin } from '@bitauth/libauth';

export const sample_pool_token_id = '412064756d6d7920746f6b656e2069642c203132332031323320313233212121';
export const sample_pool_withdraw_pubkey_hash = hexToBin('412064756d6d79207769746864726177207075626b6579206861736821212121');
// never use the private key in a public network
export const dummy_private_key = hexToBin('412064756d6d792070726976617465206b65792c6e6576657220757365732121');
export const second_dummy_private_key = hexToBin('412064756d6d792070726976617465206b6579322c6e65766572207573657321');
export const dummy_txhash = hexToBin('412064756d6d7920747820686173682c20313233203332312031323321212121');

export const aBCH = 100000000n;
