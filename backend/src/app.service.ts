import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return "Top O' the morning to ya laddies!";
  }
}
