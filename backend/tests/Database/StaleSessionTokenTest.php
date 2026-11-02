<?php

namespace Tests\Database;

use App\Models\HrmsUser;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Backend half of "never loop on a stale session": GET /api/v1/auth/me must answer with a clean 401 for every kind
 * of dead token (unknown, revoked, user deleted), never a 500 or a redirect, so the web app can treat it as logged out.
 * Runs against whatever database is configured (client data copy included); everything is rolled back.
 */
final class StaleSessionTokenTest extends DatabaseTestCase
{
    private function me(?string $token): \Illuminate\Http\Response|\Symfony\Component\HttpFoundation\Response
    {
        $this->app['auth']->forgetGuards(); // each simulated request resolves its user from its own token
        $server = ['HTTP_ACCEPT' => 'application/json'] + ($token ? ['HTTP_AUTHORIZATION' => "Bearer {$token}"] : []);

        return $this->app->make(Kernel::class)->handle(Request::create('/api/v1/auth/me', 'GET', [], [], [], $server));
    }

    private function anyUser(): HrmsUser
    {
        $user = HrmsUser::query()->where('role', 'admin')->first() ?? HrmsUser::query()->first();
        $user !== null || $this->markTestSkipped('No users in this database.');

        return $user;
    }

    public function test_a_token_issued_on_the_migrated_database_works_and_dead_tokens_get_a_clean_401(): void
    {
        $user = $this->anyUser();
        $token = $user->createToken('hrms-web', ['sv:'.$user->auth_session_version])->plainTextToken;

        $ok = $this->me($token);
        $this->assertSame(200, $ok->getStatusCode());
        $this->assertSame((string) $user->id, (string) json_decode($ok->getContent(), true)['user']['id'], 'the id the web app compares with its session cookie');

        foreach ([null, 'garbage', '999999|not-a-real-token', "{$user->id}|x"] as $dead) {
            $res = $this->me($dead);
            $this->assertSame(401, $res->getStatusCode(), 'unknown/missing token: '.var_export($dead, true));
            $this->assertMatchesRegularExpression('/unauthenticated|session expired/i', (string) $res->getContent(), 'body the web proxy uses to clear the cookies');
            $this->assertNull($res->headers->get('Location'), 'an API 401 is never a redirect');
        }

        // Revoked token (logout elsewhere / password change).
        $user->tokens()->delete();
        $this->assertSame(401, $this->me($token)->getStatusCode(), 'revoked token');

        // Password changed elsewhere: the token's session version no longer matches the user.
        $stale = $user->createToken('hrms-web', ['sv:'.($user->auth_session_version + 1)])->plainTextToken;
        $res = $this->me($stale);
        $this->assertSame(401, $res->getStatusCode(), 'stale session version');
        $this->assertMatchesRegularExpression('/session expired/i', (string) $res->getContent());
    }

    public function test_token_of_a_deleted_user_is_rejected(): void
    {
        $user = $this->anyUser();
        $token = $user->createToken('hrms-web', ['sv:'.$user->auth_session_version])->plainTextToken;
        $this->assertSame(200, $this->me($token)->getStatusCode());

        // Hard delete the user inside the (rolled back) transaction; tokens are polymorphic, so they may remain orphaned.
        DB::table('cirt_users')->where('id', $user->id)->update(['employment_status' => 'current']);
        try {
            DB::statement('SET CONSTRAINTS ALL DEFERRED');
            DB::table('cirt_users')->where('id', $user->id)->delete();
        } catch (\Throwable) {
            $this->markTestSkipped('This database does not allow deleting the user (foreign keys); covered by the revoked-token case.');
        }
        $res = $this->me($token);
        $this->assertContains($res->getStatusCode(), [401, 403, 404], 'deleted user: 4xx, never 500');
        $this->assertNull($res->headers->get('Location'));
    }

    public function test_tokens_table_is_untouched_by_the_release_migrations(): void
    {
        // Sessions started before the deploy keep working: the migrations never alter the token table.
        $columns = DB::select("select column_name from information_schema.columns where table_name = 'personal_access_tokens' order by ordinal_position");
        $this->assertSame(
            ['id', 'tokenable_type', 'tokenable_id', 'name', 'token', 'abilities', 'last_used_at', 'expires_at', 'created_at', 'updated_at'],
            array_map(fn ($c) => $c->column_name, $columns),
        );
    }
}
