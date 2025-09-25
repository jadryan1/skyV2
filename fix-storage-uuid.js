#!/usr/bin/env node

/**
 * Script to fix storage methods to use string UUIDs instead of number IDs
 */

import fs from 'fs';

const filePath = 'server/storage.ts';
let content = fs.readFileSync(filePath, 'utf8');

// Replace all method signatures from number to string
const replacements = [
  // Method signatures
  { from: 'async getBusinessInfo(userId: number)', to: 'async getBusinessInfo(userId: string)' },
  { from: 'async updateBusinessInfo(userId: number, data: any)', to: 'async updateBusinessInfo(userId: string, data: any)' },
  { from: 'async addBusinessLink(userId: number, link: string)', to: 'async addBusinessLink(userId: string, link: string)' },
  { from: 'async removeBusinessLink(userId: number, index: number)', to: 'async removeBusinessLink(userId: string, index: number)' },
  { from: 'async addBusinessFile(userId: number, fileData:', to: 'async addBusinessFile(userId: string, fileData:' },
  { from: 'async removeBusinessFile(userId: number, index: number)', to: 'async removeBusinessFile(userId: string, index: number)' },
  { from: 'async updateBusinessDescription(userId: number, description: string)', to: 'async updateBusinessDescription(userId: string, description: string)' },
  { from: 'async updateBusinessProfile(userId: number, profileData: any)', to: 'async updateBusinessProfile(userId: string, profileData: any)' },
  { from: 'async updateBusinessLogo(userId: number, logoUrl: string)', to: 'async updateBusinessLogo(userId: string, logoUrl: string)' },
  { from: 'async updateTwilioSettings(userId: number, settings:', to: 'async updateTwilioSettings(userId: string, settings:' },
  { from: 'async getCallsByUserId(userId: number)', to: 'async getCallsByUserId(userId: string)' },
  { from: 'async generateApiKey(userId: number)', to: 'async generateApiKey(userId: string)' },
  { from: 'async revokeApiKey(userId: number)', to: 'async revokeApiKey(userId: string)' },
  
  // parseInt calls
  { from: 'parseInt(req.params.userId)', to: 'req.params.userId' },
  { from: 'parseInt(userId)', to: 'userId' },
];

// Apply replacements
replacements.forEach(({ from, to }) => {
  content = content.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), to);
});

// Write back to file
fs.writeFileSync(filePath, content);
console.log('✅ Updated storage methods to use string UUIDs');
