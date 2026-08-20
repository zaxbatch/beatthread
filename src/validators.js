'use strict';

function str(value, field, { required = false, max = 200 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) return `${field} is required`;
    return null;
  }
  if (typeof value !== 'string') return `${field} must be a string`;
  if (value.trim().length > max) return `${field} must be ${max} characters or fewer`;
  return null;
}

function email(value) {
  if (!value) return 'email is required';
  if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    return 'email must be a valid email address';
  }
  return null;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  return null;
}

function validateBeat(body, { partial = false } = {}) {
  const errors = [];
  const push = (err) => { if (err) errors.push(err); };
  push(str(body.title, 'title', { required: !partial, max: 120 }));
  push(str(body.description, 'description', { max: 2000 }));
  push(str(body.genre, 'genre', { max: 40 }));
  push(str(body.bpm, 'bpm', { max: 10 }));
  return errors;
}

function validateVersion(body, { partial = false } = {}) {
  const errors = [];
  const push = (err) => { if (err) errors.push(err); };
  push(str(body.title, 'title', { required: !partial, max: 120 }));
  push(str(body.audioUrl, 'audioUrl', { required: !partial, max: 500 }));
  return errors;
}

module.exports = { validateBeat, validateVersion, validatePassword, email };
