package com.guitarreach.api.service;

import com.guitarreach.api.dto.request.HandProfileRequest;
import com.guitarreach.api.dto.response.HandProfileResponse;
import com.guitarreach.api.entity.HandProfile;
import com.guitarreach.api.entity.User;
import com.guitarreach.api.repository.HandProfileRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class HandProfileService {

    private final HandProfileRepository handProfileRepository;
    private final UserService userService;

    public HandProfileResponse getProfile(String email) {
        User user = userService.getEntityByEmail(email);
        HandProfile profile = handProfileRepository.findByUserId(user.getId())
                .orElse(HandProfile.builder().user(user).build());
        return toResponse(profile);
    }

    @Transactional
    public HandProfileResponse saveProfile(String email, HandProfileRequest req) {
        User user = userService.getEntityByEmail(email);
        HandProfile profile = handProfileRepository.findByUserId(user.getId())
                .orElse(HandProfile.builder().user(user).build());

        profile.setThumbToIndex(req.getThumbToIndex());
        profile.setIndexToMiddle(req.getIndexToMiddle());
        profile.setMiddleToRing(req.getMiddleToRing());
        profile.setRingToLittle(req.getRingToLittle());

        return toResponse(handProfileRepository.save(profile));
    }

    private HandProfileResponse toResponse(HandProfile p) {
        return HandProfileResponse.builder()
                .thumbToIndex(p.getThumbToIndex())
                .indexToMiddle(p.getIndexToMiddle())
                .middleToRing(p.getMiddleToRing())
                .ringToLittle(p.getRingToLittle())
                .updatedAt(p.getUpdatedAt())
                .build();
    }
}
