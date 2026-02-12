import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments, registerDecorator, ValidationOptions } from "class-validator";
import { ChangePasswordDto } from "../change-password.dto";

@ValidatorConstraint({ name: "IsSamePassword", async: false })
export class Validator implements ValidatorConstraintInterface {
  validate(value: string, args: ValidationArguments) {
    const obj = args.object as ChangePasswordDto;

    const oldPassword = obj.oldPassword ?? "";
    const newPassword = obj.newPassword ?? "";
    const confirmPassword = obj.confirmPassword ?? "";

    if (newPassword !== confirmPassword) {
      return false;
    }

    if (oldPassword === newPassword) {
      return false;
    }

    return true;
  }

  defaultMessage(args: ValidationArguments) {
    const obj = args.object as ChangePasswordDto;

    if (obj.newPassword !== obj.confirmPassword) {
      return "Confirm password must match new password";
    }
    if (obj.oldPassword === obj.newPassword) {
      return "New password cannot be the same as old password";
    }
    return "Invalid password data";
  }
}

export function IsSamePassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: Validator
    });
  };
}
