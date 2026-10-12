import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fail } from './store.mjs';
const format='finmate-vault-v1',aad=Buffer.from(format);
export async function vaultKey(path,provided,encrypted=false){
 if(provided!==undefined){if(typeof provided!=='string'||! /^[a-f0-9]{64}$/i.test(provided))fail('VAULT_KEY','FINMATE_STORAGE_KEY must contain exactly 64 hexadecimal characters.',500);return Buffer.from(provided,'hex');}
 const keyPath=path+'.key';let key;
 try{key=await readFile(keyPath);}catch(error){if(error.code!=='ENOENT')throw error;if(encrypted)fail('VAULT_KEY_MISSING','The financial vault key is missing. Restore the original key; the saved vault was not overwritten.',500);await mkdir(dirname(keyPath),{recursive:true});try{await writeFile(keyPath,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}key=await readFile(keyPath);}
 if(key.length!==32)fail('VAULT_KEY','The financial vault key is invalid. Saved data was not overwritten.',500);return key;
}
export function sealVault(sessions,key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);const ciphertext=Buffer.concat([cipher.update(JSON.stringify(sessions),'utf8'),cipher.final()]);return JSON.stringify({format,algorithm:'AES-256-GCM',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')});}
export function openVault(envelope,key){
 try{if(envelope.format!==format||envelope.algorithm!=='AES-256-GCM'||Object.keys(envelope).sort().join(',')!=='algorithm,ciphertext,format,iv,tag')throw new Error();const iv=Buffer.from(envelope.iv,'base64'),tag=Buffer.from(envelope.tag,'base64');if(iv.length!==12||tag.length!==16)throw new Error();const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(aad);decipher.setAuthTag(tag);return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8'));}catch{fail('VAULT_INTEGRITY','The financial vault could not be authenticated. Restore the correct key or an intact backup; no data was overwritten.',500);}
}
export const isVault=value=>Object.hasOwn(value,'format');
