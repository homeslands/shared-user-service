import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env' });

export const jwtConstants = {
  algorithm: 'RS256' as const,
  privateKey: process.env.JWT_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  publicKey: process.env.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n'),
};

export enum AccountVerificationType {
  MAIL = 'mail',
  PHONE_NUMBER = 'phone-number',
}

export enum AccountVerificationStatus {
  VERIFIED = 'verified',
  UNVERIFIED = 'unverified',
}
