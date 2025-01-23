
export class BaseException extends Error {
  public payload: any;
  constructor (message: string, payload?: any) {
    super(message, payload && payload.cause ? { cause: payload.cause } : {})
    this.payload = Object.assign({}, payload)
    if (this.payload.stack) {
      this.stack = this.payload.stack
      delete this.payload.stack
    }
  }
  get name (): string {
    return ExceptionRegistry.requireExceptionName(this.constructor as any);
  }
  static initPayload (payload: any): any {
    return Object.assign({}, payload, Object.fromEntries([
      [ 'cause', payload && payload.cause ? this.fromObject(payload.cause) : null ],
    ].filter((a) => !!a[1])))
  }
  static fromObject (data: any): BaseException {
    const cls = ExceptionRegistry.requireExceptionByName(data?.name)
    return new cls(data.message, data.payload ? this.initPayload(data.payload) : null)
  }
  toObject (): any {
    return {
      name: this.name,
      message: this.message,
      payload: Object.assign({}, this.payload, Object.fromEntries([
        [ 'cause', this.cause && typeof (this.cause as any).toObject == 'function' ? (this.cause as BaseException).toObject() : null ],
      ].filter((a) => !!a[1]))),
    }
  }
};
Object.defineProperty(BaseException, 'name', {
  value () {
    return ExceptionRegistry.getExceptionName(this)
  },
  writable: true
});

export interface IBaseExceptionConstructor {
  new (message: string, payload?: object): BaseException;
  fromObject (data: any): BaseException;
  name: string;
};

interface ExceptionEntry {
  name: string;
  exception: IBaseExceptionConstructor;
};

export class ExceptionRegistry {
  public static entries: ExceptionEntry[] = [];
  static add (name: string, exception: IBaseExceptionConstructor): void {
    this.entries.push({ name, exception });
  }
  static getExceptionName (exception: IBaseExceptionConstructor): string | null {
    let result = this.entries.find((a) => a.exception === exception);
    if (result) {
      return result.name;
    }
    return null;
  }
  static requireExceptionName (exception: IBaseExceptionConstructor): string {
    const result = this.getExceptionName(exception);
    if (!result) {
      throw new Error('Unknown exception, exception is not registered!');
    }
    return result;
  }
  static getExceptionByName (name: string): IBaseExceptionConstructor | null {
    let result = this.entries.find((a) => a.name === name);
    if (result) {
      return result.exception;
    }
    return null;
  }
  static requireExceptionByName (name: string): IBaseExceptionConstructor {
    const cls = this.getExceptionByName(name);
    if (!cls) {
      throw new Error('Unknown exception: ' + name);
    }
    return cls;
  }
};

export class Exception extends BaseException { };
export class InternalError extends Exception { };
export class NotFoundError extends Exception {
  constructor (message?: string) {
    super(message || '');
  }
};
export class ValueError extends Exception { };
export class NotImplemented extends Exception { };
export class InsufficientFunds extends Exception {
  required_amount: undefined | bigint;
  constructor (message: string | null, payload?: any) {
    super(message || 'null', payload);
    this.required_amount = payload?.required_amount == null ? undefined : BigInt(payload.required_amount);
  }
};
export class InvalidProgramState extends Exception { };
export class BurnTokenException extends Exception {
  constructor (message?: string) {
    super(message || '');
  }
};

for (let [ name, exception ] of [
  [ 'Exception', Exception ],
  [ 'InternalError', InternalError ],
  [ 'NotFoundError', NotFoundError ],
  [ 'ValueError', ValueError ],
  [ 'NotImplemented', NotImplemented ],
  [ 'InsufficientFunds', InsufficientFunds ],
  [ 'InvalidProgramState', InvalidProgramState ],
  [ 'BurnTokenException', BurnTokenException ],
]) {
  ExceptionRegistry.add(name as string, exception as IBaseExceptionConstructor)
}
