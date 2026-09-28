import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Response } from "express";
import { ERROR_MESSAGE_CONFIG } from "src/common/error-message";

type IErrorResponse = { message: string | string[] };
interface IResponseJson {
  success: boolean;
  status: number;
  message: string;
}

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const errorMessage = exception.message;
    const statusCode = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (exception instanceof HttpException) {
      const errResponse = exception.getResponse() as IErrorResponse | string;
      const rawMessage = typeof errResponse === "object" ? errResponse.message : errResponse;
      // Send the string value
      const message = Array.isArray(rawMessage) ? rawMessage[0] : rawMessage;
      const responseJson = {
        success: false,
        status: statusCode,
        message
      };
      this.logger(request, responseJson);
      response.status(statusCode).json(responseJson);
    } else {
      const responseJson = {
        success: false,
        status: statusCode,
        message: `${ERROR_MESSAGE_CONFIG.INTERNAL_SERVER_ERROR}: ${errorMessage}`
      };
      this.logger(request, responseJson);
      response.status(statusCode).json(responseJson);
    }
  }
  logger(request: Request, responseJson: IResponseJson): void {
    const method = request.method;
    const url = request.url;
    const now = Date.now();
    Logger.error(`${method} ${url} ${Date.now() - now}ms ${JSON.stringify(responseJson)}`, AppExceptionFilter.name);
  }
}
