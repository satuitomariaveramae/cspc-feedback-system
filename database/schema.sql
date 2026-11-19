-- CSPC Feedback System - MySQL schema (idempotent: safe to run more than once)
-- Load it with:  mysql -h <host> -u <user> -p --ssl-mode=REQUIRED <dbname> < database/schema.sql
-- (The app also runs this file by itself on startup.)
-- The "sessions" table is created automatically by express-mysql-session.

CREATE TABLE IF NOT EXISTS admins (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'Admin',
  email VARCHAR(255) NULL,
  reset_token_hash VARCHAR(255) NULL,
  reset_token_expires DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admins_username (username),
  KEY idx_admins_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS feedbacks (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_no VARCHAR(40) NOT NULL,
  full_name VARCHAR(150) NULL,
  email VARCHAR(255) NULL,
  student_id VARCHAR(50) NULL,
  college VARCHAR(150) NOT NULL,
  category VARCHAR(100) NOT NULL,
  feedback_type VARCHAR(30) NOT NULL DEFAULT 'Feedback',
  subject VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  rating INT NULL,
  is_anonymous TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'Pending',
  admin_notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_feedbacks_ticket (ticket_no),
  KEY idx_feedbacks_status (status),
  KEY idx_feedbacks_category (category),
  KEY idx_feedbacks_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
