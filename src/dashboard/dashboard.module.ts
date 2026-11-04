import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'dashboard', 'dist'),
      serveRoot: '/',
      exclude: ['/api/(.*)'],
      serveStaticOptions: {
        fallthrough: true,
        setHeaders: (res, filePath) => {
          res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache, must-revalidate');
        },
      },
    }),
  ],
})
export class DashboardModule {}
