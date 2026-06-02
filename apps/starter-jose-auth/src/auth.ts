import { jwtVerify, SignJWT } from 'jose';

// In production, load this from an environment variable and rotate it.
// Never commit a real secret.
const secretEnv = process.env.JWT_SECRET ?? 'dev-secret-change-me-before-production';
const secret = new TextEncoder().encode(secretEnv);

// Hard-coded demo credentials — in production use a database + hashed passwords.
const DEMO_USERS: Record<string, { password: string, email: string, name: string }> = {
  admin: {
    password: process.env.ADMIN_PASSWORD ?? 'password',
    email: 'admin@example.com',
    name: 'Admin',
  },
};

export interface JwtUser {
  sub: string;
  email: string;
  name: string;
}

export async function signToken(user: JwtUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JwtUser> {
  const { payload } = await jwtVerify(token, secret);
  return {
    sub: payload.sub as string,
    email: payload['email'] as string,
    name: payload['name'] as string,
  };
}

export function validateCredentials(username: string, password: string): JwtUser | null {
  const user = DEMO_USERS[username];
  if (!user || user.password !== password) return null;
  return { sub: username, email: user.email, name: user.name };
}
