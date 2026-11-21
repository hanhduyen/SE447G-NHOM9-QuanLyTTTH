package com.fitcenter.staffbackend.repository;

import com.fitcenter.staffbackend.model.InvoiceDetail;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface InvoiceDetailRepository
        extends JpaRepository<InvoiceDetail, Long> {

    List<InvoiceDetail> findByInvoiceId(Long invoiceId);
}
