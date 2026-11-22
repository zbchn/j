import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '4000', 10),
  PUBLIC_IP: process.env.PUBLIC_IP || '154.16.0.2',
  DOMAIN: process.env.DOMAIN || 'mered.ro',
  JWT_SECRET: process.env.JWT_SECRET || 'jessenger_fallback_secret_key_change_immediately',
  ZBCHN_INITIAL_PASSWORD: process.env.ZBCHN_INITIAL_PASSWORD || 'zbchn_root_2025',
  DB_PATH: path.resolve(process.cwd(), 'data', 'jessenger.db'),
  UPLOADS_DIR: path.resolve(process.cwd(), 'uploads'),
  SUPER_ADMIN_DEFAULT_USERNAME: 'zbchn',
  SUPER_ADMIN_DEFAULT_DISPLAY_NAME: 'admin'
};
