#!/usr/bin/env node

/**
 * Script to remove parseInt calls for userId since we're now using UUID strings
 */

import fs from 'fs';
import { glob } from 'glob';

// Find all TypeScript/JavaScript files in server directory
const files = await glob('server/**/*.{ts,js}');

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let modified = false;
  
  // Replace parseInt(req.params.userId) with req.params.userId
  if (content.includes('parseInt(req.params.userId)')) {
    content = content.replace(/parseInt\(req\.params\.userId\)/g, 'req.params.userId');
    modified = true;
  }
  
  // Replace parseInt(userId) with userId (when userId is already a string)
  if (content.includes('parseInt(userId)')) {
    content = content.replace(/parseInt\(userId\)/g, 'userId');
    modified = true;
  }
  
  if (modified) {
    fs.writeFileSync(file, content);
    console.log(`✅ Updated ${file}`);
  }
}

console.log('✅ All parseInt calls for userId have been removed');
