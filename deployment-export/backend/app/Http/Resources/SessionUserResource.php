<?php

namespace App\Http\Resources;

use App\Enums\UserRole;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** Minimal user payload returned on login (matches legacy SessionUser shape). */
class SessionUserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'email' => $this->email,
            'name' => $this->name,
            'role' => ($this->role instanceof UserRole ? $this->role : UserRole::fromStored(is_string($this->role) ? $this->role : null))->value,
            'sv' => (int) ($this->auth_session_version ?? 0),
        ];
    }
}
