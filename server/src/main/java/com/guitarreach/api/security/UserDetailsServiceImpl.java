package com.guitarreach.api.security;

import com.guitarreach.api.entity.User;
import com.guitarreach.api.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
@RequiredArgsConstructor
public class UserDetailsServiceImpl implements UserDetailsService {

    private final UserRepository userRepository;

    @Override
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        User user = userRepository.findByEmail(email)
                .orElseThrow(() -> new UsernameNotFoundException("User not found: " + email));

        // OAuth-only accounts have no local password. Spring's User requires a
        // non-null password, so substitute an unusable placeholder — these users
        // never authenticate through the password (DAO) provider, only via the
        // verified OAuth flow, so the placeholder can never match anything.
        String password = user.getPasswordHash() != null ? user.getPasswordHash() : "{noop}__oauth_no_password__";

        return new org.springframework.security.core.userdetails.User(
                user.getEmail(),
                password,
                List.of(new SimpleGrantedAuthority("ROLE_" + user.getRole().name()))
        );
    }
}
