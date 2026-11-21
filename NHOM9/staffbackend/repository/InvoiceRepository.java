package com.fitcenter.staffbackend.repository;

import com.fitcenter.staffbackend.model.Invoice;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InvoiceRepository extends JpaRepository<Invoice, Long> {}
