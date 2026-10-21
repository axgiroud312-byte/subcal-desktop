import type { LoginFlow, LoginOptions } from './types';
import { createPriorityLogin, PRIORITY_LOGIN_PROVIDERS } from './priority-login';
import { createDesktopLogin, DESKTOP_LOGIN_PROVIDERS } from './desktop-login';
import { createCliLogin, CLI_LOGIN_PROVIDERS } from './cli-login';
import { createServiceLogin, SERVICE_LOGIN_PROVIDERS } from './service-login';
import { createBuiltinLogin, BUILTIN_LOGIN_PROVIDERS } from './builtin-login';

export const REGISTERED_LOGIN_PROVIDERS = [...PRIORITY_LOGIN_PROVIDERS,...DESKTOP_LOGIN_PROVIDERS,...CLI_LOGIN_PROVIDERS,...SERVICE_LOGIN_PROVIDERS,...BUILTIN_LOGIN_PROVIDERS];

export async function createBrowserLogin(providerId: string, options: LoginOptions): Promise<LoginFlow> {
  if((PRIORITY_LOGIN_PROVIDERS as readonly string[]).includes(providerId))return createPriorityLogin(providerId,options);
  if((DESKTOP_LOGIN_PROVIDERS as readonly string[]).includes(providerId))return createDesktopLogin(providerId,options);
  if((CLI_LOGIN_PROVIDERS as readonly string[]).includes(providerId))return createCliLogin(providerId,options);
  if(SERVICE_LOGIN_PROVIDERS.includes(providerId))return createServiceLogin(providerId,options);
  if((BUILTIN_LOGIN_PROVIDERS as readonly string[]).includes(providerId))return createBuiltinLogin(providerId,options);
  throw new Error(`此服务尚未注册应用内登录：${providerId}`);
}
