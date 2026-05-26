<?php

use App\Http\Controllers\Api\V1\AttendanceController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\CompanyController;
use App\Http\Controllers\Api\V1\DepartmentController;
use App\Http\Controllers\Api\V1\DesignationController;
use App\Http\Controllers\Api\V1\DivisionController;
use App\Http\Controllers\Api\V1\EmployeeController;
use App\Http\Controllers\Api\V1\HolidayController;
use App\Http\Controllers\Api\V1\InviteController;
use App\Http\Controllers\Api\V1\LeaveController;
use App\Http\Controllers\Api\V1\PayrollController;
use App\Http\Controllers\Api\V1\PayslipController;
use App\Http\Controllers\Api\V1\ReimbursementController;
use App\Http\Controllers\Api\V1\RoleController;
use App\Http\Controllers\Api\V1\ShiftController;
use App\Http\Controllers\Api\V1\UserController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->group(function () {

    // ── Auth (public) ───────────────────────────────────────────
    Route::prefix('auth')->group(function () {
        Route::post('login', [AuthController::class, 'login']);
        Route::post('signup', [AuthController::class, 'signup']);
        Route::post('google', [AuthController::class, 'google']);
    });

    // ── Invite public endpoints (onboarding token flow) ─────────
    Route::get('invites/{token}', [InviteController::class, 'showByToken']);
    Route::post('invites/{token}/action', [InviteController::class, 'processAction']);
    Route::put('invites/{token}', [InviteController::class, 'updateByToken']);

    // ── Authenticated routes ────────────────────────────────────
    Route::middleware(['auth:sanctum', 'hrms.session'])->group(function () {

        // Auth
        Route::post('auth/logout', [AuthController::class, 'logout']);
        Route::get('auth/me', [AuthController::class, 'me']);
        Route::post('auth/change-password', [AuthController::class, 'changePassword']);

        // Current user profile
        Route::get('me', [UserController::class, 'me']);
        Route::put('me', [UserController::class, 'updateMe']);
        Route::get('me/documents', [UserController::class, 'myDocuments']);
        Route::get('me/payroll-master', [UserController::class, 'myPayrollMaster']);

        // Users (admin+)
        Route::get('users', [UserController::class, 'index']);
        Route::get('users/{id}', [UserController::class, 'show']);
        Route::put('users/{id}', [UserController::class, 'update']);

        // Employees
        Route::get('employees', [EmployeeController::class, 'index']);
        Route::post('employees', [EmployeeController::class, 'store']);
        Route::get('employees/{id}', [EmployeeController::class, 'show']);
        Route::put('employees/{id}', [EmployeeController::class, 'update']);
        Route::get('employees/{id}/onboarding', [EmployeeController::class, 'onboarding']);

        // Company
        Route::get('company/me', [CompanyController::class, 'me']);
        Route::post('company/setup', [CompanyController::class, 'setup']);
        Route::put('company/me', [CompanyController::class, 'updateMe']);
        Route::post('company/logo', [CompanyController::class, 'uploadLogo']);
        Route::get('company/documents', [CompanyController::class, 'listDocuments']);
        Route::post('company/documents', [CompanyController::class, 'storeDocument']);
        Route::put('company/documents/{id}', [CompanyController::class, 'updateDocument']);
        Route::delete('company/documents/{id}', [CompanyController::class, 'destroyDocument']);

        // Settings: Divisions
        Route::get('settings/divisions', [DivisionController::class, 'index']);
        Route::post('settings/divisions', [DivisionController::class, 'store']);
        Route::put('settings/divisions/{id}', [DivisionController::class, 'update']);
        Route::delete('settings/divisions/{id}', [DivisionController::class, 'destroy']);

        // Settings: Departments
        Route::get('settings/departments', [DepartmentController::class, 'index']);
        Route::post('settings/departments', [DepartmentController::class, 'store']);
        Route::put('settings/departments/{id}', [DepartmentController::class, 'update']);
        Route::delete('settings/departments/{id}', [DepartmentController::class, 'destroy']);

        // Settings: Designations
        Route::get('settings/designations', [DesignationController::class, 'index']);
        Route::post('settings/designations', [DesignationController::class, 'store']);
        Route::put('settings/designations/{id}', [DesignationController::class, 'update']);
        Route::delete('settings/designations/{id}', [DesignationController::class, 'destroy']);

        // Settings: Shifts
        Route::get('settings/shifts', [ShiftController::class, 'index']);
        Route::post('settings/shifts', [ShiftController::class, 'store']);
        Route::put('settings/shifts/{id}', [ShiftController::class, 'update']);
        Route::delete('settings/shifts/{id}', [ShiftController::class, 'destroy']);

        // Settings: Roles
        Route::get('settings/roles', [RoleController::class, 'index']);
        Route::post('settings/roles', [RoleController::class, 'store']);
        Route::put('settings/roles/{id}', [RoleController::class, 'update']);
        Route::delete('settings/roles/{id}', [RoleController::class, 'destroy']);

        // Attendance
        Route::get('attendance/me', [AttendanceController::class, 'me']);
        Route::post('attendance', [AttendanceController::class, 'punch']);
        Route::get('attendance/company', [AttendanceController::class, 'company']);

        // Leave
        Route::get('leave/types', [LeaveController::class, 'types']);
        Route::post('leave/types', [LeaveController::class, 'storeType']);
        Route::put('leave/types/{id}', [LeaveController::class, 'updateType']);
        Route::get('leave/policies', [LeaveController::class, 'policies']);
        Route::post('leave/policies', [LeaveController::class, 'storePolicy']);
        Route::put('leave/policies', [LeaveController::class, 'storePolicy']);
        Route::get('leave/balance', [LeaveController::class, 'balance']);
        Route::get('leave/requests', [LeaveController::class, 'requests']);
        Route::post('leave/requests', [LeaveController::class, 'storeRequest']);
        Route::put('leave/requests/{id}', [LeaveController::class, 'updateRequest']);

        // Holidays
        Route::get('holidays', [HolidayController::class, 'index']);
        Route::post('holidays', [HolidayController::class, 'store']);
        Route::put('holidays/{id}', [HolidayController::class, 'update']);
        Route::delete('holidays/{id}', [HolidayController::class, 'destroy']);

        // Payroll
        Route::get('payroll/periods', [PayrollController::class, 'periods']);
        Route::post('payroll/periods', [PayrollController::class, 'storePeriod']);
        Route::put('payroll/periods/{id}', [PayrollController::class, 'updatePeriod']);
        Route::get('payroll/master', [PayrollController::class, 'master']);
        Route::post('payroll/master', [PayrollController::class, 'storeMaster']);
        Route::patch('payroll/master', [PayrollController::class, 'upsertMaster']);
        Route::get('payroll/run', [PayrollController::class, 'runPreview']);
        Route::post('payroll/run', [PayrollController::class, 'run']);
        Route::post('payroll/payslips', [PayrollController::class, 'storePayslips']);
        Route::get('payroll/export', [PayrollController::class, 'export']);

        // Payslips
        Route::get('payslips/me', [PayslipController::class, 'me']);
        Route::get('payslips/employee', [PayslipController::class, 'forEmployee']);

        // Reimbursements
        Route::get('reimbursements', [ReimbursementController::class, 'index']);
        Route::post('reimbursements', [ReimbursementController::class, 'store']);
        Route::put('reimbursements/{id}', [ReimbursementController::class, 'update']);
        Route::post('reimbursements/upload', [ReimbursementController::class, 'upload']);

        // Invites
        Route::get('invites', [InviteController::class, 'index']);
        Route::post('invites', [InviteController::class, 'store']);
        Route::post('invites/send', [InviteController::class, 'sendInvite']);
    });
});
