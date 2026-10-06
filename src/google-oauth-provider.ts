import { google } from 'googleapis';

import type {
  GoogleOAuthCodeExchanger,
  GoogleOAuthTokenSet,
} from './google-oauth-callback.js';

export type GoogleOAuthTokenResponse = GoogleOAuthTokenSet;

export type GoogleOAuthTokenProvider = GoogleOAuthCodeExchanger;

export type GoogleOAuthClientOptions = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export class GoogleapisOAuthTokenProvider implements GoogleOAuthTokenProvider {
  private readonly client: InstanceType<typeof google.auth.OAuth2>;

  constructor(options: GoogleOAuthClientOptions) {
    this.client = new google.auth.OAuth2(
      options.clientId,
      options.clientSecret,
      options.redirectUri,
    );
  }

  async exchangeCode(code: string): Promise<GoogleOAuthTokenResponse> {
    const { tokens } = await this.client.getToken(code);
    if (!tokens.access_token || !tokens.expiry_date) {
      throw new Error('Google token response is incomplete');
    }

    this.client.setCredentials(tokens);
    const { data } = await google
      .oauth2({
        auth: this.client,
        version: 'v2',
      })
      .userinfo.get();
    if (!data.id) throw new Error('Google account identity is missing');

    return {
      accessToken: tokens.access_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      tokenExpiresAt: new Date(tokens.expiry_date),
      scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
      googleAccountId: data.id,
    };
  }
}
