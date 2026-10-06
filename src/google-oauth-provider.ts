import { google } from 'googleapis';

export type GoogleOAuthTokenResponse = {
  accessToken: string;
  refreshToken?: string;
  expiryDate: Date;
  scopes: string[];
  googleAccountId: string;
};

export interface GoogleOAuthTokenProvider {
  exchangeCode(code: string): Promise<GoogleOAuthTokenResponse>;
}

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
      expiryDate: new Date(tokens.expiry_date),
      scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
      googleAccountId: data.id,
    };
  }
}
